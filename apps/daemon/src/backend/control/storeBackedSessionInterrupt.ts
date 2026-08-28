import { codexAdapter } from "@deskcue/adapters";
import type { AgentSessionDetail, AgentSessionSummary, SessionDetail } from "@deskcue/protocol";
import { interruptCodexSession } from "#agents/codex/session/codexSessionCommands";
import type {
  ManagedSourceTurnInterruptRequest,
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
  publishSourceSessionUpdate: (session: AgentSessionSummary) => void;
  sourceTurnInterrupts: SourceTurnInterruptLifecycle;
};

function publishSourceInterruptLifecycle(
  options: StoreBackedSessionInterruptOptions,
  sourceAgentSession: AgentSessionDetail | null | undefined
) {
  if (!sourceAgentSession) return;

  const { transcript: _transcript, ...summary } = options.sourceTurnInterrupts.decorate(
    sourceAgentSession
  );

  options.publishSourceSessionUpdate(summary);
}

export async function interruptStoreBackedSession(
  options: StoreBackedSessionInterruptOptions,
  sessionId: string,
  sourceTurn?: SourceTurnInterruptTarget | null,
  sourceAgentSession?: AgentSessionDetail | null
) {
  const session = options.getSession(sessionId);

  if (session?.adapterId === codexAdapter.id && session.replyState.phase === "queued") {
    return options.cancelQueuedPrompt(session);
  }

  if (session && sourceTurn && !options.hasManagedChild(session.id)) {
    throw new AppError(
      "not_accepting_input",
      "DeskCue sees an active external agent turn, but does not have a verified control channel to interrupt it."
    );
  }

  let sourceInterruptRequest: ManagedSourceTurnInterruptRequest | null = null;
  let interruptedSession: SessionDetail | null;
  try {
    if (session && sourceTurn) {
      sourceInterruptRequest = options.sourceTurnInterrupts.requestManaged(session, sourceTurn);
      publishSourceInterruptLifecycle(options, sourceAgentSession);
    }

    interruptedSession = await interruptManagedPtySession(
      options.getCommandCallbacks(),
      sessionId
    );
  } catch (error) {
    if (session && sourceTurn && sourceInterruptRequest) {
      options.sourceTurnInterrupts.cancelManagedRequest(session, sourceTurn, sourceInterruptRequest);
      publishSourceInterruptLifecycle(options, sourceAgentSession);
    }

    throw error;
  }

  if (interruptedSession) {
    if (sourceTurn && session) {
      // A one-shot pipe transport can report its exit synchronously from kill().
      if (!options.hasManagedChild(session.id)) options.sourceTurnInterrupts.confirmManagedTransportExit(session);
      publishSourceInterruptLifecycle(options, sourceAgentSession);
    }

    return interruptedSession;
  }

  if (session && sourceTurn && sourceInterruptRequest) {
    options.sourceTurnInterrupts.cancelManagedRequest(session, sourceTurn, sourceInterruptRequest);
    publishSourceInterruptLifecycle(options, sourceAgentSession);
  }

  if (options.hasManagedChild(sessionId)) {
    throw new AppError(
      "not_accepting_input",
      "DeskCue cannot safely interrupt this managed terminal session."
    );
  }

  return interruptCodexSession(options.getCodexCallbacks(), sessionId);
}
