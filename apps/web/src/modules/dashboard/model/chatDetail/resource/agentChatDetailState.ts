import type { AgentSessionDetail } from "@deskcue/protocol";

import type {
  AgentChatDetailResourceSnapshot,
  MutableAgentChatDetailState
} from "./agentChatDetailTypes";

type Timer = ReturnType<typeof setTimeout>;

type AgentChatDetailStateStoreOptions = {
  clearTimeout: (timer: Timer) => void;
  isBusy: (sessionId: string) => boolean;
  onDispose: (sessionId: string) => void;
  setTimeout: (callback: () => void, delayMs: number) => Timer;
  stateIdleTtlMs: number;
  stateLimit: number;
};

export function createInitialSnapshot(sessionId: string): AgentChatDetailResourceSnapshot {
  return {
    detail: null,
    error: null,
    etag: null,
    isStale: false,
    lastLoadedAt: null,
    lastValidatedAt: null,
    retryAfterAt: null,
    retryAttempt: 0,
    sessionId,
    sourceVersion: null,
    staleReason: null,
    status: "idle",
    updatedAt: null
  };
}

export function createMutableAgentChatDetailState(sessionId: string): MutableAgentChatDetailState {
  return {
    ...createInitialSnapshot(sessionId),
    abortController: null,
    failedHydrationChangesByKey: new Set(),
    failedHydrationEntryIds: new Set(),
    generation: 0,
    hydratedChangesByKey: new Map(),
    hydratedEntriesById: new Map(),
    idleDisposeTimer: null,
    missingHydrationEntryIds: new Set(),
    retryTimer: null
  };
}

export function snapshotAgentChatDetailState(
  state: AgentChatDetailResourceSnapshot
): AgentChatDetailResourceSnapshot {
  return {
    detail: state.detail,
    error: state.error,
    etag: state.etag,
    isStale: state.isStale,
    lastLoadedAt: state.lastLoadedAt,
    lastValidatedAt: state.lastValidatedAt,
    retryAfterAt: state.retryAfterAt,
    retryAttempt: state.retryAttempt,
    sessionId: state.sessionId,
    sourceVersion: state.sourceVersion,
    staleReason: state.staleReason,
    status: state.status,
    updatedAt: state.updatedAt
  };
}

export class AgentChatDetailStateStore {
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly states = new Map<string, MutableAgentChatDetailState>();

  constructor(private readonly options: AgentChatDetailStateStoreOptions) {}

  subscribe(sessionId: string, listener: () => void) {
    const listeners = this.listeners.get(sessionId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    // Ownership must be registered before the LRU cap runs; otherwise a new
    // subscribed state can evict itself while all older states are active.
    const state = this.ensure(sessionId);
    this.clearIdleDisposeTimer(state);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(sessionId);
        this.scheduleIdleDispose(sessionId, state);
      }
    };
  }

  ensure(sessionId: string) {
    let state = this.states.get(sessionId);
    if (!state) {
      state = createMutableAgentChatDetailState(sessionId);
      this.states.set(sessionId, state);
      this.pruneIdleStates();
    } else {
      this.touch(state);
    }
    return state;
  }

  peek(sessionId: string) {
    return this.states.get(sessionId);
  }

  readSnapshot(sessionId: string): AgentChatDetailResourceSnapshot {
    const state = this.states.get(sessionId);
    if (state) {
      this.touch(state);
    }
    return state ? snapshotAgentChatDetailState(state) : createInitialSnapshot(sessionId);
  }

  emit(sessionId: string) {
    this.listeners.get(sessionId)?.forEach((listener) => listener());
  }

  dispose(sessionId: string) {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }
    state.abortController?.abort();
    if (state.retryTimer) {
      this.options.clearTimeout(state.retryTimer);
    }
    this.clearIdleDisposeTimer(state);
    this.states.delete(sessionId);
    this.options.onDispose(sessionId);
    this.emit(sessionId);
  }

  clear() {
    for (const state of this.states.values()) {
      state.abortController?.abort();
      if (state.retryTimer) {
        this.options.clearTimeout(state.retryTimer);
      }
      this.clearIdleDisposeTimer(state);
    }
    this.states.clear();
  }

  private scheduleIdleDispose(sessionId: string, state: MutableAgentChatDetailState) {
    this.clearIdleDisposeTimer(state);
    if (this.options.stateIdleTtlMs <= 0) {
      this.dispose(sessionId);
      return;
    }
    state.idleDisposeTimer = this.options.setTimeout(() => {
      state.idleDisposeTimer = null;
      if (!this.listeners.has(sessionId) && this.states.get(sessionId) === state) {
        this.dispose(sessionId);
      }
    }, this.options.stateIdleTtlMs);
  }

  private clearIdleDisposeTimer(state: MutableAgentChatDetailState) {
    if (!state.idleDisposeTimer) {
      return;
    }
    this.options.clearTimeout(state.idleDisposeTimer);
    state.idleDisposeTimer = null;
  }

  private touch(state: MutableAgentChatDetailState) {
    this.states.delete(state.sessionId);
    this.states.set(state.sessionId, state);
  }

  private pruneIdleStates() {
    while (this.states.size > this.options.stateLimit) {
      const candidate = [...this.states.values()].find((state) =>
        !this.listeners.has(state.sessionId) &&
        !state.abortController &&
        !state.retryTimer &&
        !this.options.isBusy(state.sessionId)
      );
      if (!candidate) {
        return;
      }
      this.dispose(candidate.sessionId);
    }
  }
}

export function hasDetailAtLeastAsFreshAs(
  detail: AgentSessionDetail | null,
  sessionId: string,
  updatedAt?: string | null
) {
  if (!updatedAt || detail?.id !== sessionId) {
    return false;
  }
  const detailTime = new Date(detail.updatedAt).getTime();
  const eventTime = new Date(updatedAt).getTime();
  if (Number.isNaN(detailTime) || Number.isNaN(eventTime)) {
    return detail.updatedAt === updatedAt;
  }
  return detailTime >= eventTime;
}
