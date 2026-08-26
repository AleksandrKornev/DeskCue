import type {
  AgentSessionDetail,
  AgentTranscriptEntry,
  PromptRecoveryState,
  ReplyState,
  SessionDetail
} from "@deskcue/protocol";
import { emptyReplyState } from "#sessions/model/sessionDefaults";

export type SessionPromptRecoveryReconciliation = {
  confirmed: boolean;
  promptRecovery: PromptRecoveryState | null;
  replyState: ReplyState;
};

function isAtOrAfterRecovery(entryTimestamp: string, requestedAt: string) {
  const entryTime = Date.parse(entryTimestamp);
  const requestedTime = Date.parse(requestedAt);

  if (Number.isNaN(entryTime) || Number.isNaN(requestedTime)) return false;

  return entryTime >= requestedTime;
}

function isTerminalRecoveryEntry(entry: AgentTranscriptEntry) {
  if (entry.role === "assistant") return entry.phase !== "non_final";
  if (entry.role !== "system") return false;

  const statusPart = entry.parts?.find((part) => part.type === "status");
  const label = statusPart?.type === "status" ? statusPart.label : entry.text;

  return label === "Turn completed" || label === "Turn interrupted" || label === "Turn failed";
}

function findMatchingRecoveryPromptIndex(
  transcript: AgentTranscriptEntry[],
  promptText: string,
  requestedAt: string
) {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];

    if (
      entry.role === "user" &&
      entry.text.trim() === promptText &&
      isAtOrAfterRecovery(entry.timestamp, requestedAt)
    ) return index;
  }

  return -1;
}

export function reconcileSessionPromptRecovery(
  session: Pick<SessionDetail, "promptRecovery">,
  agentSession: AgentSessionDetail
): SessionPromptRecoveryReconciliation | null {
  const recovery = session.promptRecovery;

  if (!recovery || recovery.phase === "not_sent" || !recovery.promptText?.trim()) return null;

  const matchingUserEntryIndex = findMatchingRecoveryPromptIndex(
    agentSession.transcript,
    recovery.promptText.trim(),
    recovery.requestedAt
  );

  if (matchingUserEntryIndex < 0) {
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

  const hasTerminalOutcome = agentSession.transcript
    .slice(matchingUserEntryIndex + 1)
    .some(isTerminalRecoveryEntry);

  if (!hasTerminalOutcome) {
    return {
      confirmed: true,
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
    replyState: emptyReplyState()
  };
}
