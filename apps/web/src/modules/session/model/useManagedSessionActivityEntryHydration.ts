import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentTranscriptChangesResponse,
  AgentTranscriptSourceRefs
} from "@deskcue/protocol";
import type {
  ChatTranscriptEntry,
  ConversationActivity,
  ManagedSessionActivityHydrationRepository
} from "@modules/session/types";

import { MAX_HYDRATION_ENTRY_IDS_BY_KIND } from "./activity/constants";
import {
  MAX_FAILED_ACTIVITY_ENTRY_IDS,
  MAX_FAILED_CHANGES_KEYS,
  MAX_HYDRATED_ACTIVITY_CACHE_ENTRIES,
  MAX_HYDRATED_CHANGES_CACHE_ENTRIES,
  buildChangesKey,
  createHydrationCache,
  createHydrationReader,
  pruneMap,
  pruneSet,
  readHydrationCache
} from "./managedSessionActivityHydrationCache";
import {
  readActivityChangesSourceRefs,
  readActivityHydrationEntryIds,
  readActivityHydrationErrorLabel as projectActivityHydrationErrorLabel,
  readHydratedActivityEntries as projectHydratedActivityEntries
} from "./managedSessionActivityHydrationProjection";

export { readActivityHydrationEntryIds } from "./managedSessionActivityHydrationProjection";

export function useManagedSessionActivityEntryHydration({
  activityHydrationRepository,
  agentSessionId,
  onHydrateAgentSessionChanges,
  onHydrateAgentSessionTranscriptEntries
}: {
  activityHydrationRepository?: ManagedSessionActivityHydrationRepository;
  agentSessionId: string | null;
  onHydrateAgentSessionChanges: (
    agentSessionId: string,
    groupId: string,
    sourceRefs?: AgentTranscriptSourceRefs
  ) => Promise<AgentTranscriptChangesResponse>;
  onHydrateAgentSessionTranscriptEntries: (
    agentSessionId: string,
    entryIds: string[]
  ) => Promise<ChatTranscriptEntry[]>;
}) {
  const hydrationGenerationRef = useRef(0);
  const hydrationCacheRef = useRef(createHydrationCache(agentSessionId));
  const [hydrationVersion, setHydrationVersion] = useState(0);

  useEffect(() => {
    hydrationGenerationRef.current += 1;
    hydrationCacheRef.current = createHydrationCache(agentSessionId);
    setHydrationVersion((current) => current + 1);
  }, [agentSessionId]);

  const bumpHydrationVersion = useCallback((generation: number) => {
    if (generation === hydrationGenerationRef.current) {
      setHydrationVersion((current) => current + 1);
    }
  }, []);

  const hydrateActivityEntries = useCallback(async (activity: ConversationActivity) => {
    if (!agentSessionId) {
      return;
    }

    const hydrationGeneration = hydrationGenerationRef.current;
    const hydrationCache = readHydrationCache(hydrationCacheRef, agentSessionId);
    const hydrationReader = createHydrationReader(
      activityHydrationRepository,
      hydrationCache,
      agentSessionId
    );

    if (activity.kind === "changes") {
      const sourceRefs = readActivityChangesSourceRefs(activity);
      const changesKey = buildChangesKey(activity.id, sourceRefs);
      if (
        hydrationReader.readChanges(activity.id, sourceRefs) ||
        hydrationCache.inFlightChangesKeys.has(changesKey)
      ) {
        return;
      }

      hydrationCache.inFlightChangesKeys.add(changesKey);
      if (!activityHydrationRepository) {
        hydrationCache.failedChangesKeys.delete(changesKey);
      }
      try {
        const changes = await onHydrateAgentSessionChanges(agentSessionId, activity.id, sourceRefs);
        if (!activityHydrationRepository && hydrationGeneration === hydrationGenerationRef.current) {
          hydrationCache.changesByKey.delete(changesKey);
          hydrationCache.changesByKey.set(changesKey, changes);
          pruneMap(hydrationCache.changesByKey, MAX_HYDRATED_CHANGES_CACHE_ENTRIES);
        }
      } catch {
        if (!activityHydrationRepository && hydrationGeneration === hydrationGenerationRef.current) {
          hydrationCache.failedChangesKeys.add(changesKey);
          pruneSet(hydrationCache.failedChangesKeys, MAX_FAILED_CHANGES_KEYS);
        }
      } finally {
        hydrationCache.inFlightChangesKeys.delete(changesKey);
        bumpHydrationVersion(hydrationGeneration);
      }
      return;
    }

    const hydrationEntryLimit = MAX_HYDRATION_ENTRY_IDS_BY_KIND[activity.kind];
    if (hydrationEntryLimit !== null && hydrationEntryLimit <= 0) {
      return;
    }

    const allEntryIds = readActivityHydrationEntryIds(activity, hydrationEntryLimit ?? undefined)
      .filter(
        (entryId) =>
          !hydrationReader.readEntry(entryId) &&
          !hydrationCache.inFlightEntryIds.has(entryId)
      );
    const entryIds = hydrationEntryLimit === null
      ? allEntryIds
      : allEntryIds.slice(-hydrationEntryLimit);
    if (entryIds.length === 0) {
      return;
    }

    for (const entryId of entryIds) {
      hydrationCache.inFlightEntryIds.add(entryId);
    }
    if (!activityHydrationRepository) {
      for (const entryId of entryIds) {
        hydrationCache.failedEntryIds.delete(entryId);
      }
    }

    try {
      const entries = await onHydrateAgentSessionTranscriptEntries(agentSessionId, entryIds);
      if (!activityHydrationRepository && hydrationGeneration === hydrationGenerationRef.current) {
        const returnedEntryIds = new Set(entries.map((entry) => entry.id));
        for (const entry of entries) {
          hydrationCache.failedEntryIds.delete(entry.id);
          hydrationCache.entriesById.delete(entry.id);
          hydrationCache.entriesById.set(entry.id, entry);
        }
        for (const entryId of entryIds) {
          if (!returnedEntryIds.has(entryId)) {
            hydrationCache.failedEntryIds.add(entryId);
          }
        }
        pruneSet(hydrationCache.failedEntryIds, MAX_FAILED_ACTIVITY_ENTRY_IDS);
        pruneMap(hydrationCache.entriesById, MAX_HYDRATED_ACTIVITY_CACHE_ENTRIES);
      }
    } catch {
      if (!activityHydrationRepository && hydrationGeneration === hydrationGenerationRef.current) {
        for (const entryId of entryIds) {
          hydrationCache.failedEntryIds.add(entryId);
        }
        pruneSet(hydrationCache.failedEntryIds, MAX_FAILED_ACTIVITY_ENTRY_IDS);
      }
    } finally {
      for (const entryId of entryIds) {
        hydrationCache.inFlightEntryIds.delete(entryId);
      }
      bumpHydrationVersion(hydrationGeneration);
    }
  }, [
    activityHydrationRepository,
    agentSessionId,
    bumpHydrationVersion,
    onHydrateAgentSessionChanges,
    onHydrateAgentSessionTranscriptEntries
  ]);

  const readHydratedActivityEntries = useCallback(
    (activity: ConversationActivity) => {
      void hydrationVersion;
      if (!agentSessionId) {
        return activity.entries;
      }

      return projectHydratedActivityEntries(
        activity,
        createHydrationReader(
          activityHydrationRepository,
          readHydrationCache(hydrationCacheRef, agentSessionId),
          agentSessionId
        )
      );
    },
    [activityHydrationRepository, agentSessionId, hydrationVersion]
  );

  const readActivityHydrationErrorLabel = useCallback(
    (activity: ConversationActivity) => {
      void hydrationVersion;
      if (!agentSessionId) {
        return null;
      }

      return projectActivityHydrationErrorLabel(
        activity,
        createHydrationReader(
          activityHydrationRepository,
          readHydrationCache(hydrationCacheRef, agentSessionId),
          agentSessionId
        )
      );
    },
    [activityHydrationRepository, agentSessionId, hydrationVersion]
  );

  return {
    hydrateActivityEntries,
    readActivityHydrationErrorLabel,
    readHydratedActivityEntries
  };
}
