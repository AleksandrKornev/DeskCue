import type { SourceLiveStateWithAttach } from "@modules/session/model/liveChat/types";
import { EXTERNAL_SOURCE_INPUT_UNAVAILABLE_LABEL } from "@modules/session/model/replyState/helpers";
import type { ConversationActivity } from "@modules/session/types";

type ReplyOutcomePhase = "completed" | "failed" | "interrupted" | null;

type ExternalSourceComposerState = {
  canSendInput: boolean;
  composerPromptInFlight: boolean;
  inputUnavailableLabel: string | null;
};

function doesEntryReferenceSource(
  entry: ConversationActivity["entries"][number],
  sourceEntryId: string
) {
  return entry.id === sourceEntryId || entry.sourceEntryIds?.includes(sourceEntryId) === true;
}

function findLatestFinalAssistantIndex(
  chatTranscriptEntries: ConversationActivity["entries"]
) {
  for (let index = chatTranscriptEntries.length - 1; index >= 0; index -= 1) {
    const entry = chatTranscriptEntries[index];

    if (entry?.role === "assistant" && entry.phase !== "non_final") return index;
  }

  return -1;
}

export function hasConfirmedExternalSourceReply(
  sourceSession: SourceLiveStateWithAttach | null,
  chatTranscriptEntries: ConversationActivity["entries"],
  expectedReplyRequestedAt: string | null = null
) {
  const turnState = sourceSession?.turnState;

  if (!turnState || turnState.phase === "active" || turnState.phase === "idle") return false;

  if (expectedReplyRequestedAt) {
    const expectedReplyRequestedTime = Date.parse(expectedReplyRequestedAt);
    const turnStartedTime = Date.parse(turnState.startedAt ?? "");

    if (
      !Number.isFinite(expectedReplyRequestedTime) ||
      !Number.isFinite(turnStartedTime) ||
      turnStartedTime < expectedReplyRequestedTime
    ) {
      return false;
    }
  }

  if (turnState.phase === "failed" || turnState.phase === "interrupted") return true;

  const latestAssistantIndex = findLatestFinalAssistantIndex(chatTranscriptEntries);

  if (latestAssistantIndex < 0) return false;

  if (turnState.turnStartFingerprint) {
    const turnStartIndex = chatTranscriptEntries.findIndex((entry) =>
      doesEntryReferenceSource(entry, turnState.turnStartFingerprint ?? "")
    );

    if (turnStartIndex >= 0) return latestAssistantIndex > turnStartIndex;
  }

  if (!turnState.startedAt) return false;

  const turnStartedAt = Date.parse(turnState.startedAt);
  const replyTimestamp = Date.parse(chatTranscriptEntries[latestAssistantIndex]?.timestamp ?? "");

  return Number.isFinite(turnStartedAt) &&
    Number.isFinite(replyTimestamp) &&
    replyTimestamp > turnStartedAt;
}

export function resolveReplyOutcome(
  sourceTerminalOutcome: ReplyOutcomePhase,
  immediateInterruptPhase: "stopping" | "interrupted" | null | undefined,
  hasCompletedManagedPromptWithFinalReply: boolean
): ReplyOutcomePhase {
  if (sourceTerminalOutcome) return sourceTerminalOutcome;
  if (immediateInterruptPhase === "interrupted") return "interrupted";
  if (hasCompletedManagedPromptWithFinalReply) return "completed";

  return null;
}

export function stabilizeExternalSourceComposerState(
  state: ExternalSourceComposerState,
  isExternalSourceReplyVisible: boolean
): ExternalSourceComposerState {
  if (!isExternalSourceReplyVisible) return state;

  return {
    canSendInput: false,
    composerPromptInFlight: false,
    inputUnavailableLabel:
      state.inputUnavailableLabel ?? EXTERNAL_SOURCE_INPUT_UNAVAILABLE_LABEL
  };
}

export function isTranscriptHistoryKnownIncomplete(
  historyIncompleteById: Map<string, boolean>,
  agentSessionId: string | null | undefined
) {
  if (!agentSessionId) return false;

  return historyIncompleteById.get(agentSessionId) === true;
}

export function buildWaitingDetailStickKey(
  entry: ConversationActivity["entries"][number] | null
) {
  if (!entry) {
    return "";
  }

  const partsKey =
    entry.parts
      ?.map((part) => {
        if (part.type === "markdown") {
          return `${part.type}:${part.text.length}`;
        }

        if (part.type === "status") {
          return `${part.type}:${part.label.length}:${part.detail?.length ?? 0}`;
        }

        if (part.type === "tool_result") {
          return `${part.type}:${part.text.length}`;
        }

        if (part.type === "diff") {
          return `${part.type}:${part.filePath?.length ?? 0}:${part.text.length}`;
        }

        return part.type;
      })
      .join("|") ?? "";

  return `${entry.id}:${entry.timestamp}:${entry.text.length}:${partsKey}`;
}
