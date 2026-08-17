import { useCallback, useEffect, useState } from "react";

import { DASHBOARD_BOOTSTRAP_MAX_WAIT_MS } from "./dashboardConstants";
import { toInitialManagedSessionLoadState } from "./helpers";
import type {
  InitialManagedSessionLoadState,
  UseDashboardBootstrapArgs
} from "./types";

export function useDashboardBootstrap({
  initialManagedSessionId,
  suppressManagedSessionAutoSelect,
  selectedSessionIdRef,
  loadOverview,
  loadAgentSessions,
  loadRuntimes,
  loadSession,
  loadSessionWithOutcome,
  setSelectedSessionId,
  setIsBootstrapping
}: UseDashboardBootstrapArgs) {
  const [initialManagedSessionLoadState, setInitialManagedSessionLoadState] =
    useState<InitialManagedSessionLoadState>({ kind: "idle" });
  const loadInitialManagedSession = useCallback(async (
    sessionId: string,
    options?: { force?: boolean }
  ) => {
    selectedSessionIdRef.current = sessionId;
    setSelectedSessionId(sessionId);
    setInitialManagedSessionLoadState({ kind: "loading" });

    const outcome = await loadSessionWithOutcome(sessionId, {
      force: options?.force,
      silent: true,
      sessionView: "chat"
    });
    if (selectedSessionIdRef.current === sessionId) {
      setInitialManagedSessionLoadState(toInitialManagedSessionLoadState(outcome));
    }
    return outcome;
  }, [loadSessionWithOutcome, selectedSessionIdRef, setSelectedSessionId]);

  useEffect(() => {
    let cancelled = false;
    let runtimesTimer: number | null = null;
    let startTimer: number | null = null;
    let watchdogTimer: number | null = null;

    const bootstrapDelay = 0;
    const finishBootstrapping = () => {
      if (!cancelled) {
        setIsBootstrapping(false);
      }
    };

    watchdogTimer = window.setTimeout(
      finishBootstrapping,
      bootstrapDelay + DASHBOARD_BOOTSTRAP_MAX_WAIT_MS
    );

    startTimer = window.setTimeout(() => {
      (async () => {
        if (initialManagedSessionId) {
          const initialSessionLoad = loadInitialManagedSession(initialManagedSessionId);
          const overviewLoad = loadOverview({
            silent: true
          });
          const agentSessionsLoad = loadAgentSessions({
            silent: true
          });
          runtimesTimer = window.setTimeout(() => {
            runtimesTimer = null;
            if (cancelled) {
              return;
            }
            loadRuntimes({
              silent: true
            });
          }, 0);
          await Promise.allSettled([initialSessionLoad, overviewLoad, agentSessionsLoad]);
          return;
        }

        setInitialManagedSessionLoadState({ kind: "idle" });

        const [nextOverview] = await Promise.all([
          loadOverview({
            silent: true
          }),
          loadAgentSessions({
            silent: true
          })
        ]);

        runtimesTimer = window.setTimeout(() => {
          runtimesTimer = null;
          if (cancelled) {
            return;
          }
          loadRuntimes({
            silent: true
          });
        }, 0);

        const preferredSession = suppressManagedSessionAutoSelect
          ? null
          : nextOverview.sessions.find((session) => session.status === "running") ?? null;

        const cachedSelectedSession = nextOverview.sessions.find(
          (session) => session.id === selectedSessionIdRef.current
        );

        const initialSessionId =
          cachedSelectedSession?.status === "running"
            ? cachedSelectedSession.id
            : preferredSession?.id;

        if (initialSessionId) {
          selectedSessionIdRef.current = initialSessionId;
          setSelectedSessionId(initialSessionId);
          void loadSession(initialSessionId, {
            silent: true,
            sessionView: "chat"
          });
        }
      })().finally(() => {
        finishBootstrapping();
      });
    }, bootstrapDelay);

    return () => {
      cancelled = true;
      if (startTimer !== null) {
        window.clearTimeout(startTimer);
      }
      if (watchdogTimer !== null) {
        window.clearTimeout(watchdogTimer);
      }
      if (runtimesTimer !== null) {
        window.clearTimeout(runtimesTimer);
      }
    };
  }, [
    initialManagedSessionId,
    selectedSessionIdRef,
    suppressManagedSessionAutoSelect,
    loadAgentSessions,
    loadInitialManagedSession,
    loadOverview,
    loadRuntimes,
    loadSession,
    setIsBootstrapping,
    setSelectedSessionId
  ]);

  return {
    initialManagedSessionLoadState,
    retryInitialManagedSessionLoad: initialManagedSessionId
      ? () => loadInitialManagedSession(initialManagedSessionId, { force: true })
      : undefined
  };
}
