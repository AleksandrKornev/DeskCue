import type {
  AgentTranscriptChangesResponse,
  AgentTranscriptSourceRefs
} from "@deskcue/protocol";
import { buildAgentTranscriptSourceRefsKey } from "@deskcue/protocol";
import type {
  ChatTranscriptEntry,
  ManagedSessionActivityHydrationRepository
} from "@modules/session/types";

export const MAX_HYDRATED_ACTIVITY_CACHE_ENTRIES = 200;
export const MAX_HYDRATED_CHANGES_CACHE_ENTRIES = 24;
export const MAX_FAILED_ACTIVITY_ENTRY_IDS = 400;
export const MAX_FAILED_CHANGES_KEYS = 48;

export type ActivityHydrationCache = {
  changesByKey: Map<string, AgentTranscriptChangesResponse>;
  entriesById: Map<string, ChatTranscriptEntry>;
  failedChangesKeys: Set<string>;
  failedEntryIds: Set<string>;
  inFlightChangesKeys: Set<string>;
  inFlightEntryIds: Set<string>;
  sessionId: string | null;
};

export type ActivityHydrationReader = {
  hasFailedChanges: (groupId: string, sourceRefs: AgentTranscriptSourceRefs) => boolean;
  hasFailedEntry: (entryId: string) => boolean;
  hasFailedEntries: (entryIds: string[]) => boolean;
  readChanges: (
    groupId: string,
    sourceRefs: AgentTranscriptSourceRefs
  ) => AgentTranscriptChangesResponse | null;
  readEntries: (entryIds: string[]) => ChatTranscriptEntry[];
  readEntry: (entryId: string) => ChatTranscriptEntry | null;
};

export function createHydrationCache(sessionId: string | null): ActivityHydrationCache {
  return {
    changesByKey: new Map(),
    entriesById: new Map(),
    failedChangesKeys: new Set(),
    failedEntryIds: new Set(),
    inFlightChangesKeys: new Set(),
    inFlightEntryIds: new Set(),
    sessionId
  };
}

export function readHydrationCache(
  cacheRef: { current: ActivityHydrationCache },
  sessionId: string | null
) {
  if (cacheRef.current.sessionId !== sessionId) {
    cacheRef.current = createHydrationCache(sessionId);
  }

  return cacheRef.current;
}

export function buildChangesKey(groupId: string, sourceRefs: AgentTranscriptSourceRefs) {
  return `${groupId}:${buildAgentTranscriptSourceRefsKey(sourceRefs)}`;
}

function readHydratedEntries(cache: ActivityHydrationCache, entryIds: string[]) {
  return entryIds
    .map((entryId) => cache.entriesById.get(entryId))
    .filter((entry): entry is ChatTranscriptEntry => Boolean(entry));
}

export function createHydrationReader(
  repository: ManagedSessionActivityHydrationRepository | undefined,
  cache: ActivityHydrationCache,
  sessionId: string
): ActivityHydrationReader {
  if (repository) {
    return {
      hasFailedChanges: (groupId, sourceRefs) =>
        repository.hasFailedChanges(sessionId, groupId, sourceRefs),
      hasFailedEntry: (entryId) => repository.hasFailedTranscriptEntry(sessionId, entryId),
      hasFailedEntries: (entryIds) =>
        repository.hasFailedTranscriptEntries(sessionId, entryIds),
      readChanges: (groupId, sourceRefs) =>
        repository.readHydratedChanges(sessionId, groupId, sourceRefs),
      readEntries: (entryIds) =>
        repository.readHydratedTranscriptEntries(sessionId, entryIds),
      readEntry: (entryId) => repository.readHydratedTranscriptEntry(sessionId, entryId)
    };
  }

  return {
    hasFailedChanges: (groupId, sourceRefs) =>
      cache.failedChangesKeys.has(buildChangesKey(groupId, sourceRefs)),
    hasFailedEntry: (entryId) => cache.failedEntryIds.has(entryId),
    hasFailedEntries: (entryIds) =>
      entryIds.some((entryId) => cache.failedEntryIds.has(entryId)),
    readChanges: (groupId, sourceRefs) =>
      cache.changesByKey.get(buildChangesKey(groupId, sourceRefs)) ?? null,
    readEntries: (entryIds) => readHydratedEntries(cache, entryIds),
    readEntry: (entryId) => cache.entriesById.get(entryId) ?? null
  };
}

export function pruneMap<Key, Value>(map: Map<Key, Value>, limit: number) {
  while (map.size > limit) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    map.delete(oldestKey);
  }
}

export function pruneSet<Value>(set: Set<Value>, limit: number) {
  while (set.size > limit) {
    const oldestValue = set.values().next().value;
    if (oldestValue === undefined) {
      return;
    }
    set.delete(oldestValue);
  }
}
