import { isApiRequestCanceled } from "@api/transport/errors";
import {
  AgentChatDetailRefreshPolicy,
  getLiveDetailNetworkThrottleIntervalMs,
  getLiveDetailRetryDelayFloorMs,
  shouldRetryAgentChatDetailError
} from "@modules/dashboard/model/chatDetail/refresh/agentChatDetailRefreshPolicy";
import type { AgentChatDetailFetchResult } from "@modules/dashboard/model/chatDetail/requests/agentChatDetailRequests";

import type { AgentChatDetailCache } from "./agentChatDetailCache";
import { hasDetailAtLeastAsFreshAs } from "./agentChatDetailState";
import type { AgentChatDetailStateStore } from "./agentChatDetailState";
import type {
  AgentChatDetailLoadOptions,
  AgentChatDetailLoadReason,
  AgentChatDetailResourceTransport,
  MutableAgentChatDetailState
} from "./agentChatDetailTypes";
import type { AgentChatHydrationRepository } from "./agentChatHydrationRepository";

type InFlightDetailRequest = {
  controller: AbortController;
  request: Promise<AgentChatDetailFetchResult>;
};

function linkAbortSignal(externalSignal: AbortSignal | undefined, controller: AbortController) {
  if (!externalSignal) return () => undefined;
  if (externalSignal.aborted) {
    controller.abort();
    return () => undefined;
  }
  const abort = () => controller.abort();
  externalSignal.addEventListener("abort", abort, { once: true });
  return () => externalSignal.removeEventListener("abort", abort);
}

export class AgentChatDetailLoader {
  private epoch = 0;
  private readonly inFlight = new Map<string, InFlightDetailRequest>();

  constructor(private readonly dependencies: {
    cache: AgentChatDetailCache;
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
    hydration: AgentChatHydrationRepository;
    now: () => number;
    refreshPolicy: AgentChatDetailRefreshPolicy;
    setTimeout: (
      callback: () => void,
      delayMs: number
    ) => ReturnType<typeof setTimeout>;
    state: AgentChatDetailStateStore;
    transport: AgentChatDetailResourceTransport;
  }) {}

  async load(
    agentSessionId: string,
    options: AgentChatDetailLoadOptions
  ): Promise<AgentChatDetailFetchResult> {
    if (!agentSessionId) {
      return { detail: null, etag: null, notModified: false, status: 404 };
    }

    const requestKey = this.dependencies.cache.buildRequestKey(agentSessionId, options);
    const cached = options.force || options.bypassDedupe
      ? null
      : this.dependencies.cache.readFresh(requestKey, options);
    if (cached) {
      this.applyResult(agentSessionId, cached, options, this.dependencies.state.ensure(agentSessionId));
      return cached;
    }

    const existing = options.bypassDedupe ? null : this.inFlight.get(requestKey);
    if (existing && !existing.controller.signal.aborted) return existing.request;

    const state = this.dependencies.state.ensure(agentSessionId);
    const throttled = this.readThrottledResult(agentSessionId, requestKey, options, state);
    if (throttled) return throttled;

    if (getLiveDetailNetworkThrottleIntervalMs(options) > 0) {
      this.dependencies.cache.rememberRequestStartedAt(requestKey);
    }

    const generation = this.startRequest(state, options.reason);
    const requestEpoch = this.epoch;
    const controller = new AbortController();
    const unlinkExternalSignal = linkAbortSignal(options.signal, controller);
    state.abortController = controller;
    const request = this.dependencies.transport.fetchDetail(agentSessionId, {
      ...options,
      baseDetail: state.detail,
      signal: controller.signal
    } as AgentChatDetailLoadOptions)
      .then((result) => {
        if (state.abortController === controller) state.abortController = null;
        if (this.epoch !== requestEpoch || state.generation !== generation) return result;

        this.applyResult(agentSessionId, result, options, state);
        if (
          options.minimumUpdatedAt && result.detail &&
          !hasDetailAtLeastAsFreshAs(result.detail, agentSessionId, options.minimumUpdatedAt)
        ) {
          state.isStale = true;
          state.staleReason = options.reason ?? "live-event";
          state.status = "stale";
          this.dependencies.state.emit(agentSessionId);
          if (options.retry !== false) this.scheduleRetry(agentSessionId, options);
        }
        this.dependencies.cache.set(requestKey, result);
        return result;
      })
      .catch((error: unknown) => {
        if (state.abortController === controller) state.abortController = null;
        if (this.epoch === requestEpoch && state.generation === generation) {
          this.applyError(agentSessionId, error, state);
          if (options.retry !== false && shouldRetryAgentChatDetailError(error)) {
            this.scheduleRetry(agentSessionId, options, error);
          }
        }
        throw error;
      })
      .finally(() => {
        unlinkExternalSignal();
        if (this.inFlight.get(requestKey)?.request === request) {
          this.inFlight.delete(requestKey);
        }
      });

    if (!options.bypassDedupe) this.inFlight.set(requestKey, { controller, request });
    return request;
  }

  clear() {
    this.epoch += 1;
    for (const request of this.inFlight.values()) {
      request.controller.abort();
    }
    this.inFlight.clear();
  }

  private startRequest(state: MutableAgentChatDetailState, reason?: AgentChatDetailLoadReason) {
    state.generation += 1;
    state.abortController?.abort();
    this.clearRetryTimer(state);
    state.error = null;
    state.isStale = Boolean(reason && state.detail);
    state.staleReason = reason ?? null;
    state.status = state.detail ? "refreshing" : "loading";
    this.dependencies.state.emit(state.sessionId);
    return state.generation;
  }

  private applyResult(
    sessionId: string,
    result: AgentChatDetailFetchResult,
    options: AgentChatDetailLoadOptions,
    state: MutableAgentChatDetailState
  ) {
    const now = this.dependencies.now();
    const nextSourceVersion = result.etag ?? state.sourceVersion;
    const nextUpdatedAt = result.detail?.updatedAt ?? state.updatedAt;
    if (
      !result.notModified &&
      ((nextSourceVersion !== null && nextSourceVersion !== state.sourceVersion) ||
        (nextUpdatedAt !== null && nextUpdatedAt !== state.updatedAt))
    ) {
      this.dependencies.hydration.onDetailChanged(state, result.detail);
    }
    state.detail = result.detail;
    state.error = null;
    state.etag = result.etag ?? state.etag;
    state.isStale = false;
    state.lastLoadedAt = result.notModified ? state.lastLoadedAt : now;
    state.lastValidatedAt = now;
    state.retryAfterAt = null;
    state.retryAttempt = 0;
    state.sourceVersion = nextSourceVersion;
    state.staleReason = null;
    state.status = "synced";
    state.updatedAt = nextUpdatedAt;
    if (
      options.minimumUpdatedAt && result.detail &&
      !hasDetailAtLeastAsFreshAs(result.detail, sessionId, options.minimumUpdatedAt)
    ) {
      state.isStale = true;
      state.staleReason = options.reason ?? "live-event";
      state.status = "stale";
    }
    this.dependencies.state.emit(sessionId);
  }

  private applyError(sessionId: string, error: unknown, state: MutableAgentChatDetailState) {
    if (isApiRequestCanceled(error)) return;
    state.error = error instanceof Error ? error : new Error("Failed to load agent chat");
    state.isStale = Boolean(state.detail);
    state.status = state.detail ? "stale" : "error";
    this.dependencies.state.emit(sessionId);
  }

  private readThrottledResult(
    sessionId: string,
    requestKey: string,
    options: AgentChatDetailLoadOptions,
    state: MutableAgentChatDetailState
  ): AgentChatDetailFetchResult | null {
    const interval = getLiveDetailNetworkThrottleIntervalMs(options);
    if (interval === 0) return null;
    const lastStartedAt = this.dependencies.cache.readLastRequestStartedAt(requestKey);
    if (
      lastStartedAt === undefined ||
      this.dependencies.now() - lastStartedAt >= interval ||
      !state.detail
    ) {
      return null;
    }
    if (!hasDetailAtLeastAsFreshAs(state.detail, sessionId, options.minimumUpdatedAt)) {
      state.isStale = true;
      state.staleReason = options.reason ?? "live-event";
      state.status = "stale";
      this.dependencies.state.emit(sessionId);
    }
    return { detail: state.detail, etag: state.etag, notModified: true, status: 304 };
  }

  private scheduleRetry(sessionId: string, options: AgentChatDetailLoadOptions, error?: unknown) {
    const state = this.dependencies.state.ensure(sessionId);
    if (!this.dependencies.refreshPolicy.canRetry(state.retryAttempt, error)) return;
    this.clearRetryTimer(state);
    const attempt = state.retryAttempt + 1;
    const delayMs = this.dependencies.refreshPolicy.resolveRetryDelay(
      attempt,
      getLiveDetailRetryDelayFloorMs(options)
    );
    state.retryAttempt = attempt;
    state.retryAfterAt = this.dependencies.now() + delayMs;
    state.retryTimer = this.dependencies.setTimeout(() => {
      state.retryTimer = null;
      void this.load(sessionId, {
        ...options,
        force: true,
        reason: "retry",
        retry: true,
        signal: undefined
      }).catch(() => undefined);
    }, delayMs);
    this.dependencies.state.emit(sessionId);
  }

  private clearRetryTimer(state: MutableAgentChatDetailState) {
    if (!state.retryTimer) return;
    this.dependencies.clearTimeout(state.retryTimer);
    state.retryTimer = null;
    state.retryAfterAt = null;
  }
}
