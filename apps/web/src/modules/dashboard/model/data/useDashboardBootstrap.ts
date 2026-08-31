import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { DASHBOARD_BOOTSTRAP_MAX_WAIT_MS } from "./dashboardConstants";
import {
  beginInitialManagedSessionLoad,
  toInitialManagedSessionLoadState
} from "./helpers";
import type {
  InitialManagedSessionLoadState,
  UseDashboardBootstrapArgs
} from "./types";

type InitialManagedSessionLoadOptions = {
  force?: boolean;
};

function claimInitialManagedSessionRoute(
  sessionId: string,
  routeGenerationRef: MutableRefObject<number>,
  selectedSessionIdRef: MutableRefObject<string>,
  selectedSessionSelectionEpochRef: MutableRefObject<number>,
  setSelectedSessionId: (value: string) => void
) {
  routeGenerationRef.current += 1;
  if (selectedSessionIdRef.current !== sessionId) {
    selectedSessionSelectionEpochRef.current += 1;
  }

  selectedSessionIdRef.current = sessionId;
  setSelectedSessionId(sessionId);
}

function invalidateInitialManagedSessionRoute(
  routeGenerationRef: MutableRefObject<number>
) {
  routeGenerationRef.current += 1;
}

function selectInitialManagedSession(
  sessionId: string,
  selectedSessionIdRef: MutableRefObject<string>,
  selectedSessionSelectionEpochRef: MutableRefObject<number>,
  setSelectedSessionId: (value: string) => void
) {
  if (selectedSessionIdRef.current !== sessionId) {
    selectedSessionSelectionEpochRef.current += 1;
  }

  selectedSessionIdRef.current = sessionId;
  setSelectedSessionId(sessionId);
}

function finishDashboardBootstrapping(
  cancelled: boolean,
  setIsBootstrapping: (value: boolean) => void
) {
  if (!cancelled) setIsBootstrapping(false);
}

export function useDashboardBootstrap({
  initialManagedSessionId,
  suppressManagedSessionAutoSelect,
  selectedSessionIdRef,
  selectedSessionSelectionEpochRef,
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
  const initialManagedSessionLoadGenerationRef = useRef(0);
  const initialManagedSessionRouteGenerationRef = useRef(0);
  const initialManagedSessionRouteOwnershipRef = useRef({
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    setSelectedSessionId
  });

  initialManagedSessionRouteOwnershipRef.current = {
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    setSelectedSessionId
  };

  useLayoutEffect(() => {
    const routeOwnership = initialManagedSessionRouteOwnershipRef.current;

    if (initialManagedSessionId) {
      claimInitialManagedSessionRoute(
        initialManagedSessionId,
        initialManagedSessionRouteGenerationRef,
        routeOwnership.selectedSessionIdRef,
        routeOwnership.selectedSessionSelectionEpochRef,
        routeOwnership.setSelectedSessionId
      );
    } else {
      invalidateInitialManagedSessionRoute(initialManagedSessionRouteGenerationRef);
    }

    setInitialManagedSessionLoadState(
      initialManagedSessionId ? { kind: "loading" } : { kind: "idle" }
    );

    return () => {
      invalidateInitialManagedSessionRoute(initialManagedSessionRouteGenerationRef);
    };
  }, [initialManagedSessionId]);

  const loadInitialManagedSession = useCallback(async (
    sessionId: string,
    options?: InitialManagedSessionLoadOptions
  ) => {
    const operationGeneration = initialManagedSessionLoadGenerationRef.current + 1;
    const routeGeneration = initialManagedSessionRouteGenerationRef.current;

    initialManagedSessionLoadGenerationRef.current = operationGeneration;

    setInitialManagedSessionLoadState((current) =>
      beginInitialManagedSessionLoad(current, options?.force === true)
    );

    const outcome = await loadSessionWithOutcome(sessionId, {
      force: options?.force,
      requestScope: "initial-route",
      silent: true,
      sessionView: "chat"
    });

    if (
      initialManagedSessionLoadGenerationRef.current === operationGeneration &&
      initialManagedSessionRouteGenerationRef.current === routeGeneration &&
      selectedSessionIdRef.current === sessionId
    ) {
      setInitialManagedSessionLoadState(toInitialManagedSessionLoadState(outcome));
    }

    return outcome;
  }, [
    loadSessionWithOutcome,
    selectedSessionIdRef
  ]);

  useEffect(() => {
    let cancelled = false;
    let runtimesTimer: number | null = null;
    let startTimer: number | null = null;
    let watchdogTimer: number | null = null;

    const bootstrapDelay = 0;

    watchdogTimer = window.setTimeout(
      () => finishDashboardBootstrapping(cancelled, setIsBootstrapping),
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

        const routeGeneration = initialManagedSessionRouteGenerationRef.current;
        const selectionEpoch = selectedSessionSelectionEpochRef.current;

        const [nextOverview] = await Promise.all([
          loadOverview({
            silent: true
          }),
          loadAgentSessions({
            silent: true
          })
        ]);

        if (
          cancelled ||
          initialManagedSessionRouteGenerationRef.current !== routeGeneration ||
          selectedSessionSelectionEpochRef.current !== selectionEpoch
        ) {
          return;
        }

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
          selectInitialManagedSession(
            initialSessionId,
            selectedSessionIdRef,
            selectedSessionSelectionEpochRef,
            setSelectedSessionId
          );

          void loadSession(initialSessionId, {
            silent: true,
            sessionView: "chat"
          });
        }
      })().finally(() => {
        finishDashboardBootstrapping(cancelled, setIsBootstrapping);
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
    selectedSessionSelectionEpochRef,
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
