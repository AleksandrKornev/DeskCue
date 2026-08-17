import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { RouteViewState } from "@models/dashboardRoute";
import {
  clearAgentBrowserListScrollTop,
  rememberAgentBrowserListScrollTop
} from "@modules/dashboard/shell/route/agentBrowserListScrollMemory";

import { useDashboardRouteScrollReset } from "./useDashboardRouteScrollReset";

function dashboardRoute(agentSessionId: string): RouteViewState {
  return {
    agentSessionId,
    kind: "dashboard",
    overlay: null,
    sessionId: "",
    sourceId: "all",
    tab: "overview"
  };
}

beforeEach(() => {
  clearAgentBrowserListScrollTop();
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: 2_000
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 844
  });
});

afterEach(() => {
  clearAgentBrowserListScrollTop();
  vi.restoreAllMocks();
});

it("restores the bounded mobile list position after closing an agent detail", () => {
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  const setIsExitingToDashboardFrame = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ routeState }) => useDashboardRouteScrollReset({
      isExitingToDashboardFrame: false,
      routeState,
      setIsExitingToDashboardFrame
    }),
    { initialProps: { routeState: dashboardRoute("codex:source-1") } }
  );

  rememberAgentBrowserListScrollTop(957);
  rerender({ routeState: dashboardRoute("") });

  expect(scrollTo).toHaveBeenCalledWith({ top: 957, left: 0, behavior: "auto" });
  unmount();
});

it("clamps a stale remembered position to the current document height", () => {
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  const { rerender, unmount } = renderHook(
    ({ routeState }) => useDashboardRouteScrollReset({
      isExitingToDashboardFrame: false,
      routeState,
      setIsExitingToDashboardFrame: vi.fn()
    }),
    { initialProps: { routeState: dashboardRoute("codex:source-1") } }
  );

  rememberAgentBrowserListScrollTop(Number.MAX_SAFE_INTEGER);
  rerender({ routeState: dashboardRoute("") });

  expect(scrollTo).toHaveBeenCalledWith({ top: 1_156, left: 0, behavior: "auto" });
  unmount();
});
