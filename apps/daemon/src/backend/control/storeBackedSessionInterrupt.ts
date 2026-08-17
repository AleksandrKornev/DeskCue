import { codexAdapter } from "@deskcue/adapters";
import type { SessionDetail } from "@deskcue/protocol";
import { interruptCodexSession } from "#agents/codex/session/codexSessionCommands";
import type {
  SourceTurnInterruptLifecycle,
  SourceTurnInterruptTarget
} from "#agents/sourceTurnInterruptLifecycle";
import { AppError } from "#application/errors";
import { interruptManagedPtySession } from "#sessions/commands/sessionCommands";

type StoreBackedSessionInterruptOptions = {
  cancelQueuedPrompt: (session: SessionDetail) => Promise<SessionDetail>;
  getCodexCallbacks: () => Parameters<typeof interruptCodexSession>[0];
  getCommandCallbacks: () => Parameters<typeof interruptManagedPtySession>[0];
  getSession: (sessionId: string) => SessionDetail | null;
  hasManagedChild: (sessionId: string) => boolean;
  sourceTurnInterrupts: SourceTurnInterruptLifecycle;
};

export async function interruptStoreBackedSession(
  options: StoreBackedSessionInterruptOptions,
  sessionId: string,
  sourceTurn?: SourceTurnInterruptTarget | null
) {
  const session = options.getSession(sessionId);
  if (session?.adapterId === codexAdapter.id && session.replyState.phase === "queued") {
    return options.cancelQueuedPrompt(session);
  }

  if (session && sourceTurn && !options.hasManagedChild(session.id)) {
    throw new AppError(
      "not_accepting_input",
      "DeskCue sees an active external Codex turn, but does not have a verified control channel to interrupt it."
    );
  }

  const interruptedSession = await interruptManagedPtySession(
    options.getCommandCallbacks(),
    sessionId
  );
  if (interruptedSession) {
    if (sourceTurn && session) {
      options.sourceTurnInterrupts.request(session, sourceTurn);
      // A one-shot pipe transport can report its exit synchronously from kill().
      if (!options.hasManagedChild(session.id)) {
        options.sourceTurnInterrupts.confirmManagedTransportExit(session);
      }
    }
    return interruptedSession;
  }

  if (options.hasManagedChild(sessionId)) {
    throw new AppError(
      "not_accepting_input",
      "DeskCue cannot safely interrupt this managed terminal session."
    );
  }

  return interruptCodexSession(options.getCodexCallbacks(), sessionId);
}
