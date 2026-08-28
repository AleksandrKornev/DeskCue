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
  terminalOutcome: "completed" | "failed" | "interrupted" | null;
};

function readTerminalRecoveryOutcome(
  entry: AgentTranscriptEntry
): SessionPromptRecoveryReconciliation["terminalOutcome"] {
  if (entry.role !== "system") return null;

  const statusPart = entry.parts?.find((part) => part.type === "status");
  const label = statusPart?.type === "status" ? statusPart.label : entry.text;

  if (label === "Turn completed") return "completed";
  if (label === "Turn interrupted") return "interrupted";
  if (label === "Turn failed") return "failed";

  return null;
}

function findRecoveryTurnEndIndex(
  transcript: AgentTranscriptEntry[],
  matchingUserEntryIndex: number
) {
  const nextUserEntryOffset = transcript
    .slice(matchingUserEntryIndex + 1)
    .findIndex((entry) => entry.role === "user");

  return nextUserEntryOffset < 0
    ? transcript.length
    : matchingUserEntryIndex + 1 + nextUserEntryOffset;
}

function findMatchingRecoveryPromptIndex(
  transcript: AgentTranscriptEntry[],
  promptText: string,
  observedPromptAt: string
) {
  for (let index = 0; index < transcript.length; index += 1) {
    const entry = transcript[index];

    if (
      entry.role === "user" &&
      entry.text.trim() === promptText &&
      entry.timestamp === observedPromptAt
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

  if (!recovery.observedPromptAt) {
    return {
      confirmed: false,
      promptRecovery: {
        ...recovery,
        phase: "outcome_unknown",
        retryable: false
      },
      replyState: emptyReplyState(),
      terminalOutcome: null
    };
  }

  const matchingUserEntryIndex = findMatchingRecoveryPromptIndex(
    agentSession.transcript,
    recovery.promptText.trim(),
    recovery.observedPromptAt
  );

  if (matchingUserEntryIndex < 0) {
    return {
      confirmed: false,
      promptRecovery: {
        ...recovery,
        phase: "outcome_unknown",
        retryable: false
      },
      replyState: emptyReplyState(),
      terminalOutcome: null
    };
  }

  const recoveryTurnEndIndex = findRecoveryTurnEndIndex(
    agentSession.transcript,
    matchingUserEntryIndex
  );
  const terminalOutcome = agentSession.transcript
    .slice(matchingUserEntryIndex + 1, recoveryTurnEndIndex)
    .map(readTerminalRecoveryOutcome)
    .find((outcome) => outcome !== null) ?? null;

  if (!terminalOutcome) {
    return {
      confirmed: true,
      promptRecovery: {
        ...recovery,
        phase: "outcome_unknown",
        retryable: false
      },
      replyState: emptyReplyState(),
      terminalOutcome: null
    };
  }

  return {
    confirmed: true,
    promptRecovery: null,
    replyState: emptyReplyState(),
    terminalOutcome
  };
}
