import type {
  AgentTranscriptEntry,
  LocalLlmChatDetail,
  LocalLlmChatEvent
} from "@deskcue/protocol";

import { isToolEvent, lifecycleDetailText } from "./localLlmTurnActivities";
import type {
  LocalLlmHistoryStream,
  LocalLlmProtectedRecordIds
} from "./types";

export { groupLocalLlmTurnActivities } from "./localLlmTurnActivities";
export type { LocalLlmTurnActivities } from "./localLlmTurnActivities";

export type LocalLlmWaitingPrompt = {
  requestedAt: string;
  text: string;
};

// Socket events drive normal refreshes. This deliberately slow timer is only a
// watchdog for a dropped event or a reconnect gap while generation is active.
export const LOCAL_LLM_RUNNING_REFRESH_INTERVAL_MS = 10_000;
export const LOCAL_LLM_LIVE_EVENT_REFRESH_MIN_INTERVAL_MS = 5_000;
const MAX_RETAINED_LOCAL_LLM_MESSAGES = 256;
const MAX_RETAINED_LOCAL_LLM_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_RETAINED_LOCAL_LLM_EVENTS = 512;
const MAX_RETAINED_LOCAL_LLM_EVENT_BYTES = 4 * 1024 * 1024;
const MAX_RETAINED_LOCAL_LLM_CHANGE_SETS = 64;
const MAX_RETAINED_LOCAL_LLM_CHANGE_SET_BYTES = 8 * 1024 * 1024;

export function localLlmChatRefreshInterval(
  generationState: LocalLlmChatDetail["generationState"] | null | undefined
) {
  if (!generationState) return null;

  return generationState === "running" ? LOCAL_LLM_RUNNING_REFRESH_INTERVAL_MS : null;
}

function estimateWireBytes(value: unknown) {
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function retainNewestWithinBudget<T extends { id: string }>(
  records: T[],
  maxCount: number,
  maxBytes: number,
  preserveIds?: ReadonlySet<string>
) {
  if (
    (!preserveIds || preserveIds.size === 0) &&
    records.length <= maxCount &&
    estimateWireBytes(records) <= maxBytes
  ) {
    return records;
  }

  const retainedIds = new Set<string>();

  if (preserveIds) {
    for (const record of records) {
      if (preserveIds.has(record.id)) retainedIds.add(record.id);
    }
  }

  let retainedBytes = 2;
  let retainedLiveCount = 0;

  for (let index = records.length - 1; index >= 0 && retainedLiveCount < maxCount; index -= 1) {
    const record = records[index];

    if (retainedIds.has(record.id)) continue;

    const recordBytes = estimateWireBytes(record) + 2;

    if (recordBytes > maxBytes || retainedBytes + recordBytes > maxBytes) continue;

    retainedIds.add(record.id);
    retainedLiveCount += 1;
    retainedBytes += recordBytes;
  }

  if (retainedIds.size === records.length) return records;

  return records.filter((record) => retainedIds.has(record.id));
}

/**
 * A local chat can run for days while compact live pages keep arriving. Keep
 * the browser backing snapshot finite; older durable records remain available
 * through the existing history cursors and are never removed from daemon
 * storage.
 */
export function boundLocalChatDetail(
  detail: LocalLlmChatDetail,
  preserveRecordIds: LocalLlmProtectedRecordIds = {}
): LocalLlmChatDetail {
  const messages = retainNewestWithinBudget(
    detail.messages,
    MAX_RETAINED_LOCAL_LLM_MESSAGES,
    MAX_RETAINED_LOCAL_LLM_MESSAGE_BYTES,
    preserveRecordIds.messages
  );
  const events = retainNewestWithinBudget(
    detail.events,
    MAX_RETAINED_LOCAL_LLM_EVENTS,
    MAX_RETAINED_LOCAL_LLM_EVENT_BYTES,
    preserveRecordIds.events
  );
  const changeSets = retainNewestWithinBudget(
    detail.changeSets,
    MAX_RETAINED_LOCAL_LLM_CHANGE_SETS,
    MAX_RETAINED_LOCAL_LLM_CHANGE_SET_BYTES,
    preserveRecordIds.changeSets
  );

  if (
    messages === detail.messages &&
    events === detail.events &&
    changeSets === detail.changeSets
  ) {
    return detail;
  }

  return { ...detail, changeSets, events, messages };
}

function mergeById<T extends { id: string; timestamp: string }>(
  current: T[],
  incoming: T[],
  mergeRecord: (previous: T, next: T) => T = (previous, next) => ({ ...previous, ...next })
) {
  const byId = new Map<string, T>();

  for (const item of current) byId.set(item.id, item);

  for (const item of incoming) {
    const previous = byId.get(item.id);

    byId.set(item.id, previous ? mergeRecord(previous, item) : item);
  }

  return [...byId.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function preserveExpandedEventSummary(
  currentSummary: string | undefined,
  incomingSummary: string | undefined
) {
  if (
    currentSummary &&
    incomingSummary?.endsWith("[Details truncated in the live update]") &&
    currentSummary.length > incomingSummary.length
  ) {
    return currentSummary;
  }

  return incomingSummary;
}

function mergeHistory(
  current: LocalLlmChatDetail["history"],
  incoming: LocalLlmChatDetail["history"],
  preserveHistoryFor: ReadonlySet<LocalLlmHistoryStream> | undefined
) {
  return (Object.keys(incoming) as LocalLlmHistoryStream[]).reduce<LocalLlmChatDetail["history"]>(
    (history, stream) => ({
      ...history,
      [stream]: preserveHistoryFor?.has(stream) ? current[stream] : incoming[stream]
    }),
    incoming
  );
}

function areEquivalentTimelineRecords(
  left: { id: string; timestamp: string },
  right: { id: string; timestamp: string } | undefined
) {
  if (left === right) return true;

  // A live/history response may enrich an existing record without changing
  // its durable id or timestamp (for example a completed tool summary or a
  // less-truncated reasoning payload). Treating those records as identical
  // leaves Details/Tools visibly stale even though mergeById accepted the new
  // fields. These bounded records are plain wire objects, so structural
  // equality is both exact and cheap at the configured tail limits.
  return Boolean(right) && JSON.stringify(left) === JSON.stringify(right);
}

function sameTimelineRecords(
  left: ReadonlyArray<{ id: string; timestamp: string }>,
  right: ReadonlyArray<{ id: string; timestamp: string }>
) {
  return left.length === right.length && left.every((entry, index) =>
    areEquivalentTimelineRecords(entry, right[index])
  );
}

function sameHistory(
  left: LocalLlmChatDetail["history"],
  right: LocalLlmChatDetail["history"]
) {
  return (Object.keys(left) as LocalLlmHistoryStream[]).every((stream) =>
    left[stream].hasMore === right[stream].hasMore &&
    left[stream].nextCursor === right[stream].nextCursor
  );
}

function sameActionRequests(
  left: LocalLlmChatDetail["actionRequests"],
  right: LocalLlmChatDetail["actionRequests"]
) {
  return left.length === right.length && left.every((request, index) => {
    const candidate = right[index];

    return request.id === candidate?.id && request.status === candidate.status;
  });
}

function samePreviewArtifacts(
  left: NonNullable<LocalLlmChatDetail["preview"]>["artifacts"],
  right: NonNullable<LocalLlmChatDetail["preview"]>["artifacts"]
) {
  const leftArtifacts = left ?? [];
  const rightArtifacts = right ?? [];

  return leftArtifacts.length === rightArtifacts.length && leftArtifacts.every((artifact, index) => {
    const candidate = rightArtifacts[index];

    return artifact.id === candidate?.id &&
      artifact.capturedAt === candidate.capturedAt &&
      artifact.targetUrl === candidate.targetUrl &&
      artifact.viewport === candidate.viewport &&
      artifact.source === candidate.source &&
      artifact.title === candidate.title &&
      artifact.notes.length === candidate.notes.length &&
      artifact.notes.every((note, noteIndex) => note === candidate.notes[noteIndex]);
  });
}

function samePreview(
  left: LocalLlmChatDetail["preview"],
  right: LocalLlmChatDetail["preview"]
) {
  if (left === right) return true;
  if (!left || !right) return false;

  return left.active === right.active &&
    left.networkMode === right.networkMode &&
    left.port === right.port &&
    left.targetUrl === right.targetUrl &&
    samePreviewArtifacts(left.artifacts, right.artifacts);
}

function sameGit(
  left: LocalLlmChatDetail["git"],
  right: LocalLlmChatDetail["git"]
) {
  if (left === right) return true;
  if (!left || !right) return false;

  return left.branch === right.branch &&
    left.isDirty === right.isDirty &&
    left.isGitRepo === right.isGitRepo &&
    left.lastUpdatedAt === right.lastUpdatedAt &&
    left.diff === right.diff &&
    left.changedFiles.length === right.changedFiles.length &&
    left.changedFiles.every((file, index) => file === right.changedFiles[index]) &&
    JSON.stringify(left.changedFileStatuses ?? {}) ===
      JSON.stringify(right.changedFileStatuses ?? {});
}

function isEquivalentLocalChatDetail(
  current: LocalLlmChatDetail,
  next: LocalLlmChatDetail
) {
  return (
    current.id === next.id &&
    current.updatedAt === next.updatedAt &&
    current.generationState === next.generationState &&
    current.generationError === next.generationError &&
    current.pendingAssistantText === next.pendingAssistantText &&
    sameGit(current.git, next.git) &&
    samePreview(current.preview, next.preview) &&
    sameTimelineRecords(current.messages, next.messages) &&
    sameTimelineRecords(current.events, next.events) &&
    sameTimelineRecords(current.changeSets, next.changeSets) &&
    sameHistory(current.history, next.history) &&
    sameActionRequests(current.actionRequests, next.actionRequests)
  );
}

export function mergeLocalChatDetail(
  current: LocalLlmChatDetail,
  incoming: LocalLlmChatDetail,
  options: {
    preserveCurrentShell?: boolean;
    preserveHistoryFor?: ReadonlySet<LocalLlmHistoryStream>;
    preserveRecordIds?: LocalLlmProtectedRecordIds;
  } = {}
): LocalLlmChatDetail {
  const preserveHistoryFor = options.preserveHistoryFor;
  const merged = boundLocalChatDetail({
    ...(options.preserveCurrentShell ? current : incoming),
    messages: mergeById(current.messages, incoming.messages),
    events: mergeById(current.events, incoming.events, (previous, next) => ({
      ...previous,
      ...next,
      summary: preserveHistoryFor?.has("events")
        ? preserveExpandedEventSummary(previous.summary, next.summary ?? previous.summary)
        : next.summary ?? previous.summary
    })),
    changeSets: mergeById(current.changeSets, incoming.changeSets, (previous, next) => ({
      ...previous,
      ...next,
      // A hydrated sidecar diff is richer than the empty placeholder carried
      // by subsequent compact live pages.
      diff: previous.diff && !next.diff ? previous.diff : next.diff
    })),
    history: mergeHistory(current.history, incoming.history, preserveHistoryFor)
  }, options.preserveRecordIds);

  // A running local chat is polled frequently. Reusing an equivalent snapshot
  // prevents the common panel from re-rendering its entire timeline just
  // because a polling response re-created equal arrays.
  return isEquivalentLocalChatDetail(current, merged) ? current : merged;
}

/**
 * The generic chat surface reserves the waiting card for a live commentary
 * entry. Local runtimes keep stream deltas in memory, so project that delta
 * (or the latest lifecycle fact for the active turn) into the same contract.
 */
export function localLlmLatestWaitingDetailEntry(detail: LocalLlmChatDetail): AgentTranscriptEntry | null {
  if (detail.generationState !== "running") return null;

  if (detail.pendingAssistantText?.trim()) {
    return {
      id: `local-llm:live:${detail.id}`,
      parts: [{ text: detail.pendingAssistantText, type: "markdown" }],
      phase: "commentary",
      role: "commentary",
      text: detail.pendingAssistantText,
      timestamp: detail.updatedAt
    };
  }

  const activeTurnId = [...detail.events].reverse().find((event) => event.type === "turn_started")?.turnId;
  const latestEvent = [...detail.events].reverse().find((event) =>
    event.turnId === activeTurnId &&
    (event.type === "turn_started" || isToolEvent(event) || event.type === "action_requested")
  );

  if (!latestEvent) return null;

  const text = lifecycleDetailText(latestEvent);

  if (!text) return null;

  return {
    id: `local-llm:waiting:${latestEvent.id}`,
    parts: [{ text, type: "markdown" }],
    phase: "commentary",
    role: "commentary",
    text,
    timestamp: latestEvent.timestamp
  };
}

export function localLlmWaitingPrompt(detail: LocalLlmChatDetail): LocalLlmWaitingPrompt | null {
  if (detail.generationState !== "running") return null;

  const started = [...detail.events].reverse().find((event) => event.type === "turn_started");

  if (!started?.messageId) return null;

  const message = detail.messages.find((candidate) =>
    candidate.id === started.messageId && candidate.role === "user"
  );

  return message ? { requestedAt: started.timestamp, text: message.text } : null;
}

export function localLlmInterruptedUserMessageIds(events: readonly LocalLlmChatEvent[]) {
  const userMessageIdByTurnId = new Map<string, string>();
  const interruptedUserMessageIds = new Set<string>();

  for (const event of events) {
    if (event.type === "turn_started" && event.messageId) {
      userMessageIdByTurnId.set(event.turnId, event.messageId);
      continue;
    }

    if (event.type === "turn_interrupted" || event.type === "turn_interrupted_after_restart") {
      const userMessageId = userMessageIdByTurnId.get(event.turnId);

      if (userMessageId) interruptedUserMessageIds.add(userMessageId);
    }
  }

  return interruptedUserMessageIds;
}
