import { useCallback } from "react";

import {
  buildRouteSearch,
  buildSessionPath
} from "@models/dashboardRoute";

import { resolveNavigateAgentSessionId } from "./helpers";
import type {
  NavigateToRoute,
  UseDashboardNavigateToRouteArgs
} from "./types";

export function useDashboardNavigateToRoute({
  activeLiveOverlay,
  activeTab,
  effectiveSelectedSessionId,
  locationPathname,
  locationSearch,
  routeState,
  selectedAgentSessionId,
  selectedSourceId,
  navigate
}: UseDashboardNavigateToRouteArgs): NavigateToRoute {
  return useCallback(
    (
      nextState,
      options
    ) => {
      let nextKind = nextState.kind ?? routeState.kind;
      const nextSourceId = nextState.sourceId ?? selectedSourceId;
      const nextAgentSessionId = resolveNavigateAgentSessionId({
        nextAgentSessionId: nextState.agentSessionId,
        routeAgentSessionId: routeState.agentSessionId,
        selectedAgentSessionId
      });
      const nextOverlay = nextState.overlay === undefined ? activeLiveOverlay : nextState.overlay;
      const nextTab = nextState.tab ?? activeTab;
      const nextSessionId =
        nextState.sessionId === undefined
          ? effectiveSelectedSessionId
          : nextState.sessionId;

      let targetPathname = "/";
      let targetSearch = "";

      if (nextKind === "session" && nextSessionId) {
        targetPathname = buildSessionPath(nextSessionId, nextTab);
        targetSearch = buildRouteSearch({
          sourceId: nextSourceId,
          agentSessionId: nextAgentSessionId,
          overlay: nextOverlay,
          includeOverlay: true
        });
      } else {
        nextKind = "dashboard";
        targetSearch = buildRouteSearch({
          sourceId: nextSourceId,
          agentSessionId: nextAgentSessionId,
          overlay: null
        });
      }

      if (locationPathname === targetPathname && locationSearch === targetSearch) {
        return;
      }

      navigate(
        {
          pathname: targetPathname,
          search: targetSearch
        },
        {
          replace: options?.replace ?? false
        }
      );
    },
    [
      activeLiveOverlay,
      activeTab,
      effectiveSelectedSessionId,
      locationPathname,
      locationSearch,
      routeState.agentSessionId,
      routeState.kind,
      selectedAgentSessionId,
      selectedSourceId,
      navigate
    ]
  );
}
