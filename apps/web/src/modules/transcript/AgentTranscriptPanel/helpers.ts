import {
  getTextOnlyTranscriptEntryText
} from "./AgentTranscriptPanel.timeline";
import type {
  AttachWaitStage,
  TextOnlyTranscriptEntry,
  TranscriptTimelineItem
} from "./types";

export const ATTACH_TRANSCRIPT_PREVIEW_ITEMS = 8;

export function getMarkReviewedSessionId({
  displaySessionId,
  isHydratingSelection,
  readyForReviewAgentSessionIds,
  sessionCommandsEnabled
}: {
  displaySessionId: string;
  isHydratingSelection: boolean;
  readyForReviewAgentSessionIds: ReadonlySet<string>;
  sessionCommandsEnabled: boolean;
}) {
  if (
    !sessionCommandsEnabled ||
    isHydratingSelection ||
    !readyForReviewAgentSessionIds.has(displaySessionId)
  ) {
    return null;
  }

  return displaySessionId;
}

export function buildTextOnlyTranscriptEntries(timeline: TranscriptTimelineItem[]) {
  return timeline.flatMap((item): TextOnlyTranscriptEntry[] => {
    if (item.type !== "entry") return [];

    const text = getTextOnlyTranscriptEntryText(item.entry);

    if (!text) return [];

    return [
      {
        id: item.entry.id,
        role: item.entry.role,
        timestamp: item.entry.timestamp,
        text
      }
    ];
  });
}

function findLastEntryIndex(
  entries: TextOnlyTranscriptEntry[],
  role: TextOnlyTranscriptEntry["role"],
  fromIndex = entries.length - 1
) {
  for (let index = Math.min(fromIndex, entries.length - 1); index >= 0; index -= 1) {
    if (entries[index].role === role) return index;
  }

  return -1;
}

export function buildVisibleTranscriptPreviewEntries(
  entries: TextOnlyTranscriptEntry[],
  previewItems: number
) {
  const minimumPreviewItems = Math.max(previewItems, 2);

  if (entries.length <= minimumPreviewItems) return entries;

  const lastAssistantIndex = findLastEntryIndex(
    entries,
    "assistant",
    entries.length - 1
  );

  if (lastAssistantIndex < 0) return entries.slice(-minimumPreviewItems);

  const pairedUserIndex = findLastEntryIndex(
    entries.slice(0, lastAssistantIndex),
    "user"
  );

  if (pairedUserIndex < 0) return entries.slice(lastAssistantIndex).slice(-minimumPreviewItems);

  const previousAssistantIndex = findLastEntryIndex(
    entries,
    "assistant",
    pairedUserIndex - 1
  );
  const previewStartIndex =
    previousAssistantIndex >= 0
      ? Math.max(previousAssistantIndex + 1, entries.length - minimumPreviewItems)
      : Math.max(pairedUserIndex, entries.length - minimumPreviewItems);

  return entries.slice(previewStartIndex);
}

export function buildAttachActionButtonLabel({
  attachWaitStage,
  attaching,
  canResume,
  hasAttachedManagedSession,
  isOpeningSharedLiveThread,
  unavailableActionLabel
}: {
  attachWaitStage: AttachWaitStage;
  attaching: boolean;
  canResume: boolean;
  hasAttachedManagedSession: boolean;
  isOpeningSharedLiveThread: boolean;
  unavailableActionLabel: string;
}) {
  if (!attaching) {
    if (hasAttachedManagedSession) return "Open live chat";

    return canResume ? "Continue chat" : unavailableActionLabel;
  }

  if (attachWaitStage === "slow") return "Still opening...";
  if (attachWaitStage === "starting" && !isOpeningSharedLiveThread) return "Opening chat...";

  return canResume ? "Opening chat..." : "Opening view...";
}
