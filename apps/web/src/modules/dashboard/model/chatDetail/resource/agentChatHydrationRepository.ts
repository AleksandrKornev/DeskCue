import type {
  AgentSessionDetail,
  AgentTranscriptChangesResponse,
  AgentTranscriptEntry,
  AgentTranscriptSourceRefs
} from "@deskcue/protocol";
import { buildAgentTranscriptSourceRefsKey } from "@deskcue/protocol";

import type {
  AgentChatDetailResourceTransport,
  MutableAgentChatDetailState
} from "./agentChatDetailTypes";

type HydrationTransport = Pick<
  AgentChatDetailResourceTransport,
  "hydrateChanges" | "hydrateTranscriptEntries"
>;

type HydrationStateAccess = {
  emit: (sessionId: string) => void;
  ensure: (sessionId: string) => MutableAgentChatDetailState;
  peek: (sessionId: string) => MutableAgentChatDetailState | undefined;
};

type QueuedHydrationTask = {
  cancel: (error: Error) => void;
  epoch: number;
  start: () => void;
};

const MAX_HYDRATED_ACTIVITY_CACHE_ENTRIES = 80;
const MAX_HYDRATED_ACTIVITY_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_HYDRATED_CHANGES_CACHE_ENTRIES = 24;
const MAX_HYDRATED_CHANGES_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_FAILED_HYDRATION_ENTRY_IDS = 400;
const MAX_FAILED_HYDRATION_CHANGES_KEYS = 48;

function asHydrationError(error: unknown) {
  return error instanceof Error ? error : new Error("Agent chat hydration failed");
}

function buildHydrateChangesRequestKey(
  agentSessionId: string,
  groupId: string,
  sourceRefs?: AgentTranscriptSourceRefs
) {
  return [
    agentSessionId,
    "changes",
    groupId,
    buildAgentTranscriptSourceRefsKey(sourceRefs ?? {})
  ].join(":");
}

function createHydrationAbortError() {
  const error = new Error("Agent chat hydration was canceled");
  error.name = "AbortError";
  return error;
}

function linkHydrationAbortSignal(
  externalSignal: AbortSignal | undefined,
  controller: AbortController
) {
  if (!externalSignal) return () => undefined;
  if (externalSignal.aborted) {
    controller.abort();
    return () => undefined;
  }
  const abort = () => controller.abort();
  externalSignal.addEventListener("abort", abort, { once: true });
  return () => externalSignal.removeEventListener("abort", abort);
}

function estimateChangesBytes(changes: Map<string, AgentTranscriptChangesResponse>) {
  let bytes = 0;
  for (const value of changes.values()) {
    try { bytes += JSON.stringify(value).length * 2; }
    catch { return MAX_HYDRATED_CHANGES_CACHE_BYTES + 1; }
  }
  return bytes;
}

function pruneHydratedChangesCache(changes: Map<string, AgentTranscriptChangesResponse>) {
  while (changes.size > MAX_HYDRATED_CHANGES_CACHE_ENTRIES ||
    estimateChangesBytes(changes) > MAX_HYDRATED_CHANGES_CACHE_BYTES) {
    const oldest = changes.keys().next().value;
    if (!oldest) return;
    changes.delete(oldest);
  }
}

function estimateHydratedEntryBytes(entries: Map<string, AgentTranscriptEntry>) {
  let bytes = 0;
  for (const entry of entries.values()) {
    try { bytes += JSON.stringify(entry).length; } catch { bytes += entry.text.length; }
  }
  return bytes;
}

function pruneHydratedEntryCache(entries: Map<string, AgentTranscriptEntry>) {
  while (entries.size > MAX_HYDRATED_ACTIVITY_CACHE_ENTRIES ||
    estimateHydratedEntryBytes(entries) > MAX_HYDRATED_ACTIVITY_ENTRY_BYTES) {
    const oldest = entries.keys().next().value;
    if (!oldest) return;
    entries.delete(oldest);
  }
}

function pruneSet<Value>(set: Set<Value>, limit: number) {
  while (set.size > limit) {
    const oldest = set.values().next().value;
    if (oldest === undefined) return;
    set.delete(oldest);
  }
}

function readHydratedEntries(state: MutableAgentChatDetailState, entryIds: string[]) {
  return entryIds
    .map((entryId) => state.hydratedEntriesById.get(entryId))
    .filter((entry): entry is AgentTranscriptEntry => Boolean(entry));
}

function readHydrationEntryLineRef(entryId: string) {
  const separatorIndex = entryId.lastIndexOf("-");
  if (separatorIndex < 0 || separatorIndex === entryId.length - 1) return null;
  const lineIndex = Number(entryId.slice(separatorIndex + 1));
  return Number.isInteger(lineIndex) && lineIndex >= 0
    ? { lineIndex, prefix: entryId.slice(0, separatorIndex + 1) }
    : null;
}

function readMaxKnownLineIndexByEntryPrefix(detail: AgentSessionDetail) {
  const result = new Map<string, number>();
  const remember = (entryId: string | undefined) => {
    if (!entryId) return;
    const ref = readHydrationEntryLineRef(entryId);
    if (ref) result.set(ref.prefix, Math.max(result.get(ref.prefix) ?? -1, ref.lineIndex));
  };
  const rememberActivity = (activity: {
    sourceEntryIds?: string[];
    sourceEntryRanges?: Array<{ prefix: string; end: number }>;
    sourceEntrySpans?: Array<{ prefix: string; end: number }>;
  }) => {
    for (const id of activity.sourceEntryIds ?? []) remember(id);
    for (const range of [...(activity.sourceEntryRanges ?? []), ...(activity.sourceEntrySpans ?? [])]) {
      remember(`${range.prefix}${range.end}`);
    }
  };
  for (const entry of detail.transcript) {
    remember(entry.id);
    rememberActivity(entry);
  }
  for (const item of detail.transcriptView?.items ?? []) {
    if (item.type === "message") {
      remember(item.entry.id);
      for (const activity of [...item.activities, ...item.changeActivities]) rememberActivity(activity);
    } else {
      rememberActivity(item.activity);
    }
  }
  return result;
}

function shouldRetainMissingHydrationEntry(
  entryId: string,
  maxLineIndexByPrefix: Map<string, number>
) {
  const lineRef = readHydrationEntryLineRef(entryId);
  if (!lineRef) return false;
  const maxKnown = maxLineIndexByPrefix.get(lineRef.prefix);
  return maxKnown !== undefined && lineRef.lineIndex <= maxKnown;
}

export class AgentChatHydrationRepository {
  private activeRequestCount = 0;
  private readonly controllers = new Set<AbortController>();
  private epoch = 0;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly queue: QueuedHydrationTask[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly state: HydrationStateAccess,
    private readonly transport: HydrationTransport
  ) {}

  hydrateTranscriptEntries(
    agentSessionId: string,
    entryIds: string[],
    options?: { signal?: AbortSignal }
  ) {
    const state = this.state.ensure(agentSessionId);
    const uniqueEntryIds = Array.from(new Set(entryIds.map((id) => id.trim()).filter(Boolean)));
    if (uniqueEntryIds.length === 0) {
      return Promise.resolve([]);
    }
    const missingEntryIds = uniqueEntryIds.filter((entryId) =>
      !state.hydratedEntriesById.has(entryId) &&
      !state.missingHydrationEntryIds.has(entryId)
    );
    if (missingEntryIds.length === 0) {
      return Promise.resolve(readHydratedEntries(state, uniqueEntryIds));
    }
    for (const entryId of missingEntryIds) {
      state.failedHydrationEntryIds.delete(entryId);
    }

    const requestKey = `${agentSessionId}:entries:${[...missingEntryIds].sort().join(",")}`;
    const existing = this.inFlight.get(requestKey);
    if (existing) {
      return existing.then(() => readHydratedEntries(state, uniqueEntryIds));
    }

    const requestEpoch = this.epoch;
    const request = this.run((signal) =>
      this.transport.hydrateTranscriptEntries(agentSessionId, missingEntryIds, {
        ...options,
        signal
      }), options?.signal
    ).then((result) => {
      if (this.epoch !== requestEpoch) return [];
      const returnedEntryIds = new Set<string>();
      for (const entry of result.data.entries) {
        if (entry.isCompact) {
          continue;
        }
        returnedEntryIds.add(entry.id);
        state.failedHydrationEntryIds.delete(entry.id);
        state.missingHydrationEntryIds.delete(entry.id);
        state.hydratedEntriesById.delete(entry.id);
        state.hydratedEntriesById.set(entry.id, entry);
      }
      for (const entryId of missingEntryIds) {
        if (!returnedEntryIds.has(entryId)) {
          state.failedHydrationEntryIds.add(entryId);
          state.missingHydrationEntryIds.add(entryId);
        }
      }
      pruneSet(state.failedHydrationEntryIds, MAX_FAILED_HYDRATION_ENTRY_IDS);
      pruneSet(state.missingHydrationEntryIds, MAX_FAILED_HYDRATION_ENTRY_IDS);
      pruneHydratedEntryCache(state.hydratedEntriesById);
      this.state.emit(agentSessionId);
      return readHydratedEntries(state, uniqueEntryIds);
    }).catch((error: unknown) => {
      if (this.epoch !== requestEpoch) throw error;
      for (const entryId of missingEntryIds) {
        state.failedHydrationEntryIds.add(entryId);
      }
      pruneSet(state.failedHydrationEntryIds, MAX_FAILED_HYDRATION_ENTRY_IDS);
      this.state.emit(agentSessionId);
      throw error;
    }).finally(() => {
      if (this.inFlight.get(requestKey) === request) {
        this.inFlight.delete(requestKey);
      }
    });

    this.inFlight.set(requestKey, request);
    return request;
  }

  hydrateChanges(
    agentSessionId: string,
    groupId: string,
    sourceRefs?: AgentTranscriptSourceRefs,
    options?: { signal?: AbortSignal }
  ) {
    const state = this.state.ensure(agentSessionId);
    const requestKey = buildHydrateChangesRequestKey(agentSessionId, groupId, sourceRefs);
    const cached = state.hydratedChangesByKey.get(requestKey);
    if (cached) {
      return Promise.resolve(cached);
    }
    state.failedHydrationChangesByKey.delete(requestKey);
    const existing = this.inFlight.get(requestKey);
    if (existing) {
      return existing as Promise<AgentTranscriptChangesResponse>;
    }

    const requestEpoch = this.epoch;
    const request = this.run((signal) =>
      this.transport.hydrateChanges(agentSessionId, groupId, sourceRefs, {
        ...options,
        signal
      }), options?.signal
    ).then((result) => {
      if (this.epoch !== requestEpoch) throw createHydrationAbortError();
      state.failedHydrationChangesByKey.delete(requestKey);
      state.hydratedChangesByKey.delete(requestKey);
      state.hydratedChangesByKey.set(requestKey, result.data);
      pruneHydratedChangesCache(state.hydratedChangesByKey);
      this.state.emit(agentSessionId);
      return result.data;
    }).catch((error: unknown) => {
      if (this.epoch !== requestEpoch) throw error;
      state.failedHydrationChangesByKey.add(requestKey);
      pruneSet(state.failedHydrationChangesByKey, MAX_FAILED_HYDRATION_CHANGES_KEYS);
      this.state.emit(agentSessionId);
      throw error;
    }).finally(() => {
      if (this.inFlight.get(requestKey) === request) {
        this.inFlight.delete(requestKey);
      }
    });
    this.inFlight.set(requestKey, request);
    return request;
  }

  readTranscriptEntry(sessionId: string, entryId: string) {
    return this.state.peek(sessionId)?.hydratedEntriesById.get(entryId) ?? null;
  }

  readTranscriptEntries(sessionId: string, entryIds: string[]) {
    const state = this.state.peek(sessionId);
    return state ? readHydratedEntries(state, entryIds) : [];
  }

  hasFailedTranscriptEntry(sessionId: string, entryId: string) {
    return this.state.peek(sessionId)?.failedHydrationEntryIds.has(entryId) ?? false;
  }

  hasFailedTranscriptEntries(sessionId: string, entryIds: string[]) {
    const state = this.state.peek(sessionId);
    return state ? entryIds.some((id) => state.failedHydrationEntryIds.has(id)) : false;
  }

  readChanges(sessionId: string, groupId: string, sourceRefs?: AgentTranscriptSourceRefs) {
    const key = buildHydrateChangesRequestKey(sessionId, groupId, sourceRefs);
    return this.state.peek(sessionId)?.hydratedChangesByKey.get(key) ?? null;
  }

  hasFailedChanges(sessionId: string, groupId: string, sourceRefs?: AgentTranscriptSourceRefs) {
    const key = buildHydrateChangesRequestKey(sessionId, groupId, sourceRefs);
    return this.state.peek(sessionId)?.failedHydrationChangesByKey.has(key) ?? false;
  }

  hasSessionInFlight(sessionId: string) {
    return [...this.inFlight.keys()].some((key) => key.startsWith(`${sessionId}:`));
  }

  clear() {
    this.epoch += 1;
    const error = createHydrationAbortError();
    const queued = this.queue.splice(0);
    for (const task of queued) task.cancel(error);
    for (const controller of this.controllers) controller.abort();
    this.activeRequestCount = 0;
    this.inFlight.clear();
  }

  onDetailChanged(state: MutableAgentChatDetailState, detail: AgentSessionDetail | null) {
    const maxLineIndexByPrefix = detail
      ? readMaxKnownLineIndexByEntryPrefix(detail)
      : new Map<string, number>();
    for (const entryId of [...state.missingHydrationEntryIds]) {
      if (shouldRetainMissingHydrationEntry(entryId, maxLineIndexByPrefix)) {
        continue;
      }
      state.failedHydrationEntryIds.delete(entryId);
      state.missingHydrationEntryIds.delete(entryId);
    }
  }

  private run<T>(
    request: (signal: AbortSignal) => Promise<T>,
    externalSignal?: AbortSignal
  ): Promise<T> {
    const taskEpoch = this.epoch;
    const controller = new AbortController();
    const unlinkExternalSignal = linkHydrationAbortSignal(externalSignal, controller);
    this.controllers.add(controller);

    return new Promise((resolve, reject) => {
      let released = false;
      let settled = false;
      let started = false;
      const abortListener: { current: () => void } = {
        current: () => undefined
      };
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const release = () => {
        if (released) return;
        released = true;
        controller.signal.removeEventListener("abort", abortListener.current);
        unlinkExternalSignal();
        this.controllers.delete(controller);
        if (started && this.epoch === taskEpoch) {
          this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
          this.drainQueue();
        }
      };
      const task: QueuedHydrationTask = {
        cancel: (error) => {
          rejectOnce(error);
          release();
        },
        epoch: taskEpoch,
        start: () => {
          if (settled || this.epoch !== taskEpoch) {
            rejectOnce(createHydrationAbortError());
            release();
            return;
          }
          started = true;
          this.activeRequestCount += 1;
          request(controller.signal).then((value) => {
            if (!settled) {
              settled = true;
              resolve(value);
            }
          }).catch((error: unknown) => rejectOnce(asHydrationError(error))).finally(release);
        }
      };
      const handleAbort = () => {
        rejectOnce(createHydrationAbortError());
        if (!started) {
          const queueIndex = this.queue.indexOf(task);
          if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
        }
        release();
      };
      abortListener.current = handleAbort;
      controller.signal.addEventListener("abort", handleAbort, { once: true });
      if (controller.signal.aborted) {
        handleAbort();
        return;
      }
      if (this.activeRequestCount < this.concurrency) {
        task.start();
      } else {
        this.queue.push(task);
      }
    });
  }

  private drainQueue() {
    while (this.activeRequestCount < this.concurrency) {
      const task = this.queue.shift();
      if (!task) return;
      if (task.epoch !== this.epoch) {
        task.cancel(createHydrationAbortError());
        continue;
      }
      task.start();
    }
  }
}
