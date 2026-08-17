import type {
  AgentSessionDetail,
  PromptRecoveryState,
  ReplyState,
  SessionDetail
} from "@deskcue/protocol";
import { deriveReplyStateFromAgentSession } from "#agents/codex/session/codexReplyState";
import { emptyReplyState } from "#sessions/model/sessionDefaults";

export type SessionPromptRecoveryReconciliation = {
  confirmed: boolean;
  promptRecovery: PromptRecoveryState | null;
  replyState: ReplyState;
};

function isAtOrAfterRecovery(entryTimestamp: string, requestedAt: string) {
  const entryTime = Date.parse(entryTimestamp);
  const requestedTime = Date.parse(requestedAt);
  if (Number.isNaN(entryTime) || Number.isNaN(requestedTime)) {
    return false;
  }
  return entryTime >= requestedTime;
}

export function reconcileSessionPromptRecovery(
  session: Pick<SessionDetail, "inputHistory" | "promptRecovery">,
  agentSession: AgentSessionDetail
): SessionPromptRecoveryReconciliation | null {
  const recovery = session.promptRecovery;
  if (!recovery || recovery.phase === "not_sent" || !recovery.promptText?.trim()) {
    return null;
  }

  const matchingUserEntry = [...agentSession.transcript]
    .reverse()
    .find((entry) =>
      entry.role === "user" &&
      entry.text.trim() === recovery.promptText?.trim() &&
      isAtOrAfterRecovery(entry.timestamp, recovery.requestedAt)
    );

  if (!matchingUserEntry) {
    return {
      confirmed: false,
      promptRecovery: {
        ...recovery,
        phase: "outcome_unknown",
        retryable: false
      },
      replyState: emptyReplyState()
    };
  }

  return {
    confirmed: true,
    promptRecovery: null,
    replyState: deriveReplyStateFromAgentSession(
      {
        inputHistory: session.inputHistory,
        replyState: {
          phase: "sending",
          promptText: recovery.promptText,
          requestedAt: recovery.requestedAt
        }
      },
      agentSession
    )
  };
}
