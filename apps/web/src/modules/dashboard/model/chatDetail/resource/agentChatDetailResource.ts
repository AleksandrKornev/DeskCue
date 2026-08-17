import type {
  AgentSessionDetail,
  AgentTranscriptSourceRefs
} from "@deskcue/protocol";
import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import {
  AgentChatDetailRefreshPolicy
} from "@modules/dashboard/model/chatDetail/refresh/agentChatDetailRefreshPolicy";
import { readAgentChatDetail } from "@modules/dashboard/model/chatDetail/requests/agentChatDetailRequests";

import { AgentChatDetailCache } from "./agentChatDetailCache";
import { AgentChatDetailLoader } from "./agentChatDetailLoader";
import {
  AgentChatDetailStateStore,
  hasDetailAtLeastAsFreshAs
} from "./agentChatDetailState";
import type {
  AgentChatDetailLoadOptions,
  AgentChatDetailLoadReason,
  AgentChatDetailResourceSnapshot,
  AgentChatDetailResourceTransport
} from "./agentChatDetailTypes";
import { AgentChatHydrationRepository } from "./agentChatHydrationRepository";

export type {
  AgentChatDetailLoadOptions,
  AgentChatDetailLoadReason,
  AgentChatDetailResourceSnapshot,
  AgentChatDetailResourceStatus,
  AgentChatDetailResourceTransport
} from "./agentChatDetailTypes";
export { shouldRetryAgentChatDetailError } from "@modules/dashboard/model/chatDetail/refresh/agentChatDetailRefreshPolicy";

type AgentChatDetailResourceOptions = {
  cacheLimit?: number;
  cacheTtlMs?: number;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  hydrationConcurrency?: number;
  maxRetryAttempts?: number;
  now?: () => number;
  random?: () => number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  stateIdleTtlMs?: number;
  stateLimit?: number;
  setTimeout?: (
    callback: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout>;
  transport?: AgentChatDetailResourceTransport;
};

const DEFAULT_CACHE_TTL_MS = 15_000;
const DEFAULT_CACHE_LIMIT = 32;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;
const DEFAULT_MAX_RETRY_ATTEMPTS = 4;
const DEFAULT_HYDRATION_CONCURRENCY = 2;
const DEFAULT_STATE_IDLE_TTL_MS = 2 * 60_000;
const DEFAULT_STATE_LIMIT = 48;

/**
 * Stable source-chat repository facade. Detail state, request caching,
 * hydration and refresh policy intentionally live in separate collaborators;
 * consumers keep one repository identity and the historical public API.
 */
function createDefaultTransport(): AgentChatDetailResourceTransport {
  return {
    fetchDetail: (sessionId, options) => readAgentChatDetail(sessionId, options),
    hydrateChanges: (sessionId, groupId, sourceRefs, options) =>
      agentSessionsApi.getChangesWithMeta(sessionId, groupId, {
        ...sourceRefs,
        signal: options?.signal
      }),
    hydrateTranscriptEntries: (sessionId, entryIds, options) =>
      agentSessionsApi.getTranscriptEntriesWithMeta(sessionId, entryIds, options)
  };
}

export class AgentChatDetailResource {
  private readonly cache: AgentChatDetailCache;
  private readonly clearTimeoutFn: NonNullable<AgentChatDetailResourceOptions["clearTimeout"]>;
  private readonly hydration: AgentChatHydrationRepository;
  private readonly loader: AgentChatDetailLoader;
  private readonly now: () => number;
  private readonly setTimeoutFn: NonNullable<AgentChatDetailResourceOptions["setTimeout"]>;
  private readonly state: AgentChatDetailStateStore;
  private readonly transport: AgentChatDetailResourceTransport;

  constructor(options: AgentChatDetailResourceOptions = {}) {
    this.clearTimeoutFn = options.clearTimeout ?? ((timer) => globalThis.clearTimeout(timer));
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeout ??
      ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.transport = options.transport ?? createDefaultTransport();
    this.cache = new AgentChatDetailCache(
      options.cacheLimit ?? DEFAULT_CACHE_LIMIT,
      options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      this.now
    );
    const refreshPolicy = new AgentChatDetailRefreshPolicy({
      maxRetryAttempts: options.maxRetryAttempts ?? DEFAULT_MAX_RETRY_ATTEMPTS,
      random: options.random ?? (() => Math.random()),
      retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      retryMaxDelayMs: options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS
    });

    const hydrationRef: { current?: AgentChatHydrationRepository } = {};
    this.state = new AgentChatDetailStateStore({
      clearTimeout: this.clearTimeoutFn,
      isBusy: (sessionId) => hydrationRef.current?.hasSessionInFlight(sessionId) ?? false,
      onDispose: (sessionId) => this.cache.clearSession(sessionId),
      setTimeout: this.setTimeoutFn,
      stateIdleTtlMs: options.stateIdleTtlMs ?? DEFAULT_STATE_IDLE_TTL_MS,
      stateLimit: Math.max(1, options.stateLimit ?? DEFAULT_STATE_LIMIT)
    });
    const hydration = new AgentChatHydrationRepository(
      options.hydrationConcurrency ?? DEFAULT_HYDRATION_CONCURRENCY,
      {
        emit: (sessionId) => this.state.emit(sessionId),
        ensure: (sessionId) => this.state.ensure(sessionId),
        peek: (sessionId) => this.state.peek(sessionId)
      },
      this.transport
    );
    hydrationRef.current = hydration;
    this.hydration = hydration;
    this.loader = new AgentChatDetailLoader({
      cache: this.cache,
      clearTimeout: this.clearTimeoutFn,
      hydration,
      now: this.now,
      refreshPolicy,
      setTimeout: this.setTimeoutFn,
      state: this.state,
      transport: this.transport
    });
  }

  subscribe(sessionId: string, listener: () => void) {
    return this.state.subscribe(sessionId, listener);
  }

  readSnapshot(sessionId: string): AgentChatDetailResourceSnapshot {
    return this.state.readSnapshot(sessionId);
  }

  hasRecentlyValidatedDetail(sessionId: string, maxAgeMs: number) {
    const state = this.state.peek(sessionId);
    return Boolean(
      state?.detail &&
      !state.isStale &&
      state.status !== "error" &&
      state.lastValidatedAt !== null &&
      this.now() - state.lastValidatedAt < maxAgeMs
    );
  }

  invalidate(
    sessionId: string,
    options: {
      minimumUpdatedAt?: string | null;
      reason?: AgentChatDetailLoadReason;
    } = {}
  ) {
    if (!sessionId) return false;
    const state = this.state.ensure(sessionId);
    if (hasDetailAtLeastAsFreshAs(state.detail, sessionId, options.minimumUpdatedAt)) {
      return false;
    }
    state.isStale = true;
    state.staleReason = options.reason ?? "live-event";
    state.status = state.detail ? "stale" : "idle";
    this.state.emit(sessionId);
    return true;
  }

  async loadDetail(agentSessionId: string, options: AgentChatDetailLoadOptions) {
    return (await this.load(agentSessionId, options)).detail;
  }

  async refreshNow(agentSessionId: string, options: AgentChatDetailLoadOptions) {
    return (await this.load(agentSessionId, {
      ...options,
      force: true,
      retry: options.retry ?? true
    })).detail;
  }

  async load(
    agentSessionId: string,
    options: AgentChatDetailLoadOptions
  ) {
    return this.loader.load(agentSessionId, options);
  }

  hydrateTranscriptEntries(
    sessionId: string,
    entryIds: string[],
    options?: { signal?: AbortSignal }
  ) {
    return this.hydration.hydrateTranscriptEntries(sessionId, entryIds, options);
  }

  hydrateChanges(
    sessionId: string,
    groupId: string,
    sourceRefs?: AgentTranscriptSourceRefs,
    options?: { signal?: AbortSignal }
  ) {
    return this.hydration.hydrateChanges(sessionId, groupId, sourceRefs, options);
  }

  readHydratedTranscriptEntry(sessionId: string, entryId: string) {
    return this.hydration.readTranscriptEntry(sessionId, entryId);
  }

  readHydratedTranscriptEntries(sessionId: string, entryIds: string[]) {
    return this.hydration.readTranscriptEntries(sessionId, entryIds);
  }

  hasFailedTranscriptEntry(sessionId: string, entryId: string) {
    return this.hydration.hasFailedTranscriptEntry(sessionId, entryId);
  }

  hasFailedTranscriptEntries(sessionId: string, entryIds: string[]) {
    return this.hydration.hasFailedTranscriptEntries(sessionId, entryIds);
  }

  readHydratedChanges(sessionId: string, groupId: string, refs?: AgentTranscriptSourceRefs) {
    return this.hydration.readChanges(sessionId, groupId, refs);
  }

  hasFailedChanges(sessionId: string, groupId: string, refs?: AgentTranscriptSourceRefs) {
    return this.hydration.hasFailedChanges(sessionId, groupId, refs);
  }

  disposeSession(sessionId: string) {
    this.state.dispose(sessionId);
  }

  clear() {
    this.loader.clear();
    this.hydration.clear();
    this.state.clear();
    this.cache.clear();
  }
}

export const agentChatDetailResource = new AgentChatDetailResource();

export function hasAgentChatDetailAtLeastAsFreshAsEvent(
  detail: AgentSessionDetail | null,
  sessionId: string,
  updatedAt?: string | null
) {
  return hasDetailAtLeastAsFreshAs(detail, sessionId, updatedAt);
}
