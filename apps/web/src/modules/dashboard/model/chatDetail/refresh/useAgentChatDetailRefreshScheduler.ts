import { useCallback, useEffect, useRef } from "react";

import {
  agentChatDetailResource,
  hasAgentChatDetailAtLeastAsFreshAsEvent
} from "@modules/dashboard/model/chatDetail/resource/agentChatDetailResource";
import { getBackpressuredRefreshDelay } from "@modules/dashboard/model/liveUpdates/helpers";

import {
  mergeAgentChatDetailRefreshOptions,
  resolveAgentChatDetailReadTranscriptDetail,
  shouldDeferAgentChatDetailRefreshWhileHidden,
  shouldSkipPassiveAgentChatDetailRefresh
} from "./helpers";
import type {
  AgentChatDetailRefreshOptions,
  UseAgentChatDetailRefreshSchedulerArgs
} from "./types";

export function useAgentChatDetailRefreshScheduler({
  activeTabRef,
  applyFetchedAgentSessionDetail,
  currentDetailRef,
  minIntervalMs,
  readTranscriptDetail,
  resetKey,
  sessionIdRef,
  shouldRefresh
}: UseAgentChatDetailRefreshSchedulerArgs) {
  const resolvedReadTranscriptDetail =
    resolveAgentChatDetailReadTranscriptDetail(readTranscriptDetail);
  const refreshTimerRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const refreshGenerationRef = useRef(0);
  const queuedRefreshPendingRef = useRef(false);
  const queuedRefreshOptionsRef = useRef<AgentChatDetailRefreshOptions | null>(null);
  const queuedRefreshUpdatedAtRef = useRef<string | null>(null);
  const refreshStartedAtRef = useRef(0);
  const scheduleRefreshRef = useRef<(
    updatedAt?: string | null,
    options?: AgentChatDetailRefreshOptions
  ) => void>(() => undefined);

  const clearScheduledRefresh = useCallback(() => {
    refreshGenerationRef.current += 1;
    queuedRefreshPendingRef.current = false;
    queuedRefreshOptionsRef.current = null;
    queuedRefreshUpdatedAtRef.current = null;
    refreshInFlightRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const canRefresh = useCallback((options: AgentChatDetailRefreshOptions) => {
    return shouldRefresh ? shouldRefresh(options) : true;
  }, [shouldRefresh]);

  const fetchAndApply = useCallback(async (
    updatedAt?: string | null,
    generation = refreshGenerationRef.current,
    options: AgentChatDetailRefreshOptions = {}
  ) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !canRefresh({ allowDuringPromptPolling: true, ...options })) {
      return;
    }

    refreshInFlightRef.current = true;
    refreshStartedAtRef.current = Date.now();
    queuedRefreshPendingRef.current = false;
    queuedRefreshUpdatedAtRef.current = null;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const activeTab = activeTabRef.current;
      const session = await agentChatDetailResource.loadDetail(sessionId, {
        activeTab,
        fullTranscript: options.fullTranscript,
        force: options.force,
        minNetworkIntervalMs: minIntervalMs,
        minimumUpdatedAt: updatedAt,
        reason: options.reason ?? "live-event",
        retry: true,
        signal: abortController.signal,
        transcriptDetail: resolvedReadTranscriptDetail(activeTab)
      });

      if (!session || generation !== refreshGenerationRef.current || sessionIdRef.current !== session.id) {
        return;
      }

      applyFetchedAgentSessionDetail(session);
    } catch {
      // Live update refresh is opportunistic; the next event or manual load will retry.
    } finally {
      if (abortControllerRef.current === abortController && generation === refreshGenerationRef.current) {
        abortControllerRef.current = null;
        refreshInFlightRef.current = false;
      }
    }
  }, [
    activeTabRef,
    applyFetchedAgentSessionDetail,
    canRefresh,
    minIntervalMs,
    resolvedReadTranscriptDetail,
    sessionIdRef
  ]);

  const scheduleAgentChatDetailRefresh = useCallback((
    updatedAt?: string | null,
    options: AgentChatDetailRefreshOptions = {}
  ) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !canRefresh(options)) {
      return;
    }

    if (
      shouldSkipPassiveAgentChatDetailRefresh({
        minIntervalMs,
        now: Date.now(),
        options,
        snapshot: agentChatDetailResource.readSnapshot(sessionId),
        updatedAt
      })
    ) {
      return;
    }

    const currentDetail = currentDetailRef.current;
    if (!options.force && hasAgentChatDetailAtLeastAsFreshAsEvent(currentDetail, sessionId, updatedAt)) {
      return;
    }

    agentChatDetailResource.invalidate(sessionId, {
      minimumUpdatedAt: updatedAt,
      reason: options.reason ?? "live-event"
    });

    if (shouldDeferAgentChatDetailRefreshWhileHidden(options.reason)) {
      return;
    }

    queuedRefreshPendingRef.current = true;
    queuedRefreshOptionsRef.current = mergeAgentChatDetailRefreshOptions(
      queuedRefreshOptionsRef.current,
      options
    );
    queuedRefreshUpdatedAtRef.current = updatedAt ?? queuedRefreshUpdatedAtRef.current;

    if (refreshTimerRef.current !== null || refreshInFlightRef.current) {
      return;
    }

    const refreshDelay = getBackpressuredRefreshDelay(refreshStartedAtRef.current, minIntervalMs);
    const refreshGeneration = refreshGenerationRef.current;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;

      const activeSessionId = sessionIdRef.current;
      if (
        refreshGeneration !== refreshGenerationRef.current ||
        !activeSessionId ||
        refreshInFlightRef.current ||
        !canRefresh(options)
      ) {
        return;
      }

      refreshInFlightRef.current = true;
      refreshStartedAtRef.current = Date.now();
      const queuedUpdatedAt = queuedRefreshUpdatedAtRef.current;
      const queuedOptions = queuedRefreshOptionsRef.current ?? options;
      queuedRefreshPendingRef.current = false;
      queuedRefreshOptionsRef.current = null;
      queuedRefreshUpdatedAtRef.current = null;
      const activeTab = activeTabRef.current;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      agentChatDetailResource.loadDetail(activeSessionId, {
        activeTab,
        force: queuedOptions.force,
        fullTranscript: queuedOptions.fullTranscript,
        minNetworkIntervalMs: minIntervalMs,
        minimumUpdatedAt: queuedUpdatedAt,
        reason: queuedOptions.reason ?? "live-event",
        retry: true,
        signal: abortController.signal,
        transcriptDetail: resolvedReadTranscriptDetail(activeTab)
      })
        .then((session) => {
          if (
            !session ||
            refreshGeneration !== refreshGenerationRef.current ||
            sessionIdRef.current !== session.id
          ) {
            return;
          }

          if (queuedUpdatedAt && session.updatedAt < queuedUpdatedAt) {
            queuedRefreshPendingRef.current = true;
            queuedRefreshOptionsRef.current = mergeAgentChatDetailRefreshOptions(
              queuedRefreshOptionsRef.current,
              queuedOptions
            );
            queuedRefreshUpdatedAtRef.current = queuedUpdatedAt;
          }

          applyFetchedAgentSessionDetail(session);
        })
        .catch(() => {})
        .finally(() => {
          if (
            abortControllerRef.current !== abortController ||
            refreshGeneration !== refreshGenerationRef.current
          ) {
            return;
          }

          abortControllerRef.current = null;
          refreshInFlightRef.current = false;

          if (queuedRefreshPendingRef.current || queuedRefreshUpdatedAtRef.current) {
            scheduleRefreshRef.current(
              queuedRefreshUpdatedAtRef.current,
              queuedRefreshOptionsRef.current ?? queuedOptions
            );
          }
        });
    }, refreshDelay);
  }, [
    activeTabRef,
    applyFetchedAgentSessionDetail,
    canRefresh,
    currentDetailRef,
    minIntervalMs,
    resolvedReadTranscriptDetail,
    sessionIdRef
  ]);

  const refreshAgentChatDetailNow = useCallback((
    updatedAt?: string | null,
    options: AgentChatDetailRefreshOptions = {}
  ) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !canRefresh({ allowDuringPromptPolling: true, ...options })) {
      return;
    }

    if (
      shouldSkipPassiveAgentChatDetailRefresh({
        minIntervalMs,
        now: Date.now(),
        options,
        snapshot: agentChatDetailResource.readSnapshot(sessionId),
        updatedAt
      })
    ) {
      return;
    }

    const currentDetail = currentDetailRef.current;
    if (!options.force && hasAgentChatDetailAtLeastAsFreshAsEvent(currentDetail, sessionId, updatedAt)) {
      return;
    }

    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (refreshInFlightRef.current) {
      queuedRefreshPendingRef.current = true;
      queuedRefreshOptionsRef.current = mergeAgentChatDetailRefreshOptions(
        queuedRefreshOptionsRef.current,
        options
      );
      queuedRefreshUpdatedAtRef.current = updatedAt ?? queuedRefreshUpdatedAtRef.current;
      return;
    }

    const refreshGeneration = refreshGenerationRef.current;
    void fetchAndApply(updatedAt, refreshGeneration, options)
      .finally(() => {
        if (refreshGeneration !== refreshGenerationRef.current) {
          return;
        }

        if (queuedRefreshPendingRef.current || queuedRefreshUpdatedAtRef.current) {
          scheduleAgentChatDetailRefresh(
            queuedRefreshUpdatedAtRef.current,
            queuedRefreshOptionsRef.current ?? { allowDuringPromptPolling: true }
          );
        }
      });
  }, [
    canRefresh,
    currentDetailRef,
    fetchAndApply,
    minIntervalMs,
    scheduleAgentChatDetailRefresh,
    sessionIdRef
  ]);

  useEffect(() => {
    scheduleRefreshRef.current = scheduleAgentChatDetailRefresh;
  }, [scheduleAgentChatDetailRefresh]);

  useEffect(() => {
    clearScheduledRefresh();
  }, [clearScheduledRefresh, resetKey]);

  useEffect(() => {
    return () => {
      clearScheduledRefresh();
    };
  }, [clearScheduledRefresh]);

  return {
    refreshAgentChatDetailNow,
    scheduleAgentChatDetailRefresh
  };
}
