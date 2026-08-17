import { AppError } from "#application/errors";

export type ReservedLocalLlmChatCommand = {
  cancelRequested: boolean;
  kind: "generation" | "mutation" | "send";
  promise: Promise<unknown>;
  signal: AbortSignal;
};

type MutableReservedLocalLlmChatCommand = ReservedLocalLlmChatCommand & {
  controller: AbortController;
};

/** Serializes the short command-starting window independently per chat. */
export class LocalLlmChatCommandScheduler {
  private closing = false;
  private readonly reservationsByChatId = new Map<string, MutableReservedLocalLlmChatCommand>();

  async run<T>(
    chatId: string,
    kind: ReservedLocalLlmChatCommand["kind"],
    command: (reservation: ReservedLocalLlmChatCommand) => Promise<T>
  ) {
    if (this.closing) {
      throw new AppError("conflict", "Local chat service is shutting down.");
    }
    if (this.reservationsByChatId.has(chatId)) {
      throw new AppError("conflict", "Another local chat operation is still starting.");
    }
    const controller = new AbortController();
    const reservation: MutableReservedLocalLlmChatCommand = {
      cancelRequested: false,
      controller,
      kind,
      promise: Promise.resolve(),
      signal: controller.signal
    };
    this.reservationsByChatId.set(chatId, reservation);
    const promise = command(reservation);
    reservation.promise = promise;
    try {
      return await promise;
    } finally {
      if (this.reservationsByChatId.get(chatId) === reservation) {
        this.reservationsByChatId.delete(chatId);
      }
    }
  }

  async cancelStartingGeneration(chatId: string) {
    const reservation = this.reservationsByChatId.get(chatId);
    if (!reservation) return;
    if (reservation.kind === "send" || reservation.kind === "generation") {
      reservation.cancelRequested = true;
      reservation.controller.abort();
    }
    await reservation.promise.catch(() => undefined);
  }

  beginClose() {
    this.closing = true;
    const reservations = [...this.reservationsByChatId.values()];
    for (const reservation of reservations) {
      reservation.cancelRequested = true;
      reservation.controller.abort();
    }
    return reservations.map((reservation) => reservation.promise);
  }
}
