import type { SessionDetail } from "@deskcue/protocol";
import { AppError } from "#application/errors";

import type {
  PreparedPromptDelivery,
  PromptDeliveryJournal,
  StoreBackedPromptTransportCoordinatorOptions
} from "./storeBackedPromptTransportCoordinator.types.ts";

export const noOpPromptDeliveryJournal: PromptDeliveryJournal = {
  markAccepted: () => true,
  markAcceptedBySession: () => true,
  markActiveOutcomeUnknownForShutdown: () => 0,
  markCompleted: () => {},
  markDispatching: () => true,
  markDispatchingBySession: () => true,
  markInterrupted: () => {},
  markNotSent: () => true,
  markNotSentAfterActiveWriterConflict: () => true,
  markNotSentAfterSynchronousSpawnFailure: () => true,
  markNotSentBySession: () => true,
  markObservedBySession: () => true,
  markOutcomeUnknown: () => true,
  markOutcomeUnknownBySession: () => true,
  prepare: () => ""
};

export class StoreBackedPromptDeliveryLifecycle {
  private readonly inFlightPromptSessionIds = new Set<string>();
  private readonly shutdownDrainWaiters: Array<() => void> = [];
  private shuttingDown = false;

  constructor(
    private readonly options: StoreBackedPromptTransportCoordinatorOptions
  ) {}

  isShuttingDown() {
    return this.shuttingDown;
  }

  assertCanStart(session: SessionDetail) {
    if (this.shuttingDown) {
      throw new AppError(
        "not_accepting_input",
        "DeskCue is shutting down and cannot start another prompt."
      );
    }

    if (session.promptRecovery && !session.promptRecovery.retryable) {
      throw new AppError(
        "not_accepting_input",
        "The previous prompt delivery outcome is still unknown."
      );
    }

    if (session.replyState.phase !== "idle") {
      throw new AppError(
        "not_accepting_input",
        "Session is already handling a prompt."
      );
    }
  }

  async runGuarded<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    if (this.inFlightPromptSessionIds.has(sessionId)) {
      throw new AppError(
        "not_accepting_input",
        "Session is already handling a prompt."
      );
    }

    this.inFlightPromptSessionIds.add(sessionId);

    try {
      return await run();
    } finally {
      this.inFlightPromptSessionIds.delete(sessionId);
      if (this.inFlightPromptSessionIds.size === 0) {
        for (const resolve of this.shutdownDrainWaiters.splice(0)) {
          resolve();
        }
      }
    }
  }

  async beginShutdown() {
    this.shuttingDown = true;
    this.options.promptDeliveries.markActiveOutcomeUnknownForShutdown();
    if (this.inFlightPromptSessionIds.size > 0) {
      await new Promise<void>((resolve) => {
        this.shutdownDrainWaiters.push(resolve);
      });
    }
  }

  markFailed(
    sessionId: string,
    preparedDelivery: PreparedPromptDelivery
  ): "not_sent" | "outcome_unknown" | null {
    const definitelyNotSent = preparedDelivery.kind === "exact"
      ? this.options.promptDeliveries.markNotSent(preparedDelivery.deliveryId)
      : this.options.promptDeliveries.markNotSentBySession(sessionId);
    if (definitelyNotSent) return "not_sent";

    if (preparedDelivery.kind === "exact") {
      return this.options.promptDeliveries.markOutcomeUnknown(preparedDelivery.deliveryId)
        ? "outcome_unknown"
        : null;
    }

    return this.options.promptDeliveries.markOutcomeUnknownBySession(sessionId)
      ? "outcome_unknown"
      : null;
  }

  markAccepted(sessionId: string, preparedDelivery: PreparedPromptDelivery) {
    const transitioned = preparedDelivery.kind === "exact"
      ? this.options.promptDeliveries.markAccepted(preparedDelivery.deliveryId)
      : this.options.promptDeliveries.markAcceptedBySession(sessionId);
    if (!transitioned) {
      if (preparedDelivery.kind === "exact") {
        this.options.promptDeliveries.markOutcomeUnknown(preparedDelivery.deliveryId);
      } else {
        this.options.promptDeliveries.markOutcomeUnknownBySession(sessionId);
      }

      this.options.updateSession(sessionId, {
        promptRecovery: {
          phase: "outcome_unknown",
          promptText: preparedDelivery.promptText,
          requestedAt: preparedDelivery.requestedAt,
          retryable: false
        }
      });
      return;
    }

    this.options.updateSession(sessionId, { promptRecovery: null });
  }

  markDispatching(sessionId: string, preparedDelivery: PreparedPromptDelivery) {
    const transitioned = preparedDelivery.kind === "exact"
      ? this.options.promptDeliveries.markDispatching(preparedDelivery.deliveryId)
      : this.options.promptDeliveries.markDispatchingBySession(sessionId);
    if (!transitioned) throw new Error("Prompt delivery journal was not prepared before dispatch.");
  }

  async persistRecovery(
    sessionId: string,
    preparedDelivery: PreparedPromptDelivery,
    disposition: "not_sent" | "outcome_unknown" | null
  ) {
    if (!disposition) return;

    const currentSession = this.options.getSession(sessionId);

    if (disposition === "not_sent" && currentSession?.promptRecovery) return;

    this.options.updateSession(sessionId, {
      promptRecovery: {
        phase: disposition,
        promptText: preparedDelivery.promptText,
        requestedAt: preparedDelivery.requestedAt,
        retryable: disposition === "not_sent"
      }
    });

    await this.options.persistState();
  }
}
