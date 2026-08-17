import type { AgentTranscriptViewItem } from "@deskcue/protocol";

import { buildAgentTranscriptView } from "../../../../../transcript/agentTranscriptView.ts";

export function buildTranscriptViewDelta(
  transcriptView: ReturnType<typeof buildAgentTranscriptView>,
  options: {
    baseItemKey: string | null;
    overlapItemCount: number;
  }
) {
  const baseItemIndex = options.baseItemKey
    ? transcriptView.items.findIndex((item) => item.key === options.baseItemKey)
    : -1;
  const replaceFromIndex = baseItemIndex >= 0
    ? Math.max(0, baseItemIndex - options.overlapItemCount)
    : 0;
  const replaceFromItemKey = transcriptView.items[replaceFromIndex]?.key ?? null;

  return {
    ...transcriptView,
    items: transcriptView.items.slice(replaceFromIndex),
    replaceFromItemKey
  };
}

function findCurrentTurnDetailsActivityIndex(
  items: AgentTranscriptViewItem[],
  baseItemIndex: number
) {
  let currentTurnStartIndex = -1;
  for (let index = baseItemIndex; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === "message" && item.role === "user") {
      currentTurnStartIndex = index;
      break;
    }
  }

  if (currentTurnStartIndex < 0) {
    return -1;
  }

  for (let index = currentTurnStartIndex + 1; index <= baseItemIndex; index += 1) {
    const item = items[index];
    if (item?.type === "activity" && item.activity.kind === "details") {
      return index;
    }
  }

  return -1;
}

function readLightweightTranscriptDeltaReplaceIndex(
  items: AgentTranscriptViewItem[],
  baseItemIndex: number,
  baseItemKey: string,
  overlapItemCount: number
) {
  const minIndex = Math.max(0, baseItemIndex - overlapItemCount);
  for (let index = baseItemIndex; index >= minIndex; index -= 1) {
    if (items[index]?.key === baseItemKey) {
      return index;
    }
  }

  for (let index = baseItemIndex - 1; index >= minIndex; index -= 1) {
    if (items[index]?.type === "message") {
      return index;
    }
  }

  return baseItemIndex;
}

export function buildLightweightTranscriptDelta(
  transcriptView: ReturnType<typeof buildAgentTranscriptView>,
  baseItemIndex: number,
  baseItemKey: string,
  overlapItemCount: number
) {
  let replaceFromIndex = readLightweightTranscriptDeltaReplaceIndex(
    transcriptView.items,
    baseItemIndex,
    baseItemKey,
    overlapItemCount
  );
  const liveDetailsIndex = findCurrentTurnDetailsActivityIndex(
    transcriptView.items,
    baseItemIndex
  );

  // Include the current turn's Details activity in every replacement window;
  // otherwise its live count can remain stale until the terminal full refresh.
  if (liveDetailsIndex >= 0) {
    replaceFromIndex = Math.min(replaceFromIndex, liveDetailsIndex);
  }
  const replaceFromItemKey = replaceFromIndex < baseItemIndex
    ? transcriptView.items[replaceFromIndex]?.key ?? baseItemKey
    : baseItemKey;

  return {
    ...transcriptView,
    items: transcriptView.items.slice(replaceFromIndex),
    replaceFromItemKey
  };
}
