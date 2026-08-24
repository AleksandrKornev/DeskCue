import { useEffect } from "react";

import { consumeAgentBrowserListScrollTop } from "@modules/agents/panel/state/agentBrowserListMemory";

import {
  resetWindowScroll,
  restoreWindowScroll,
  shouldResetWindowScrollOnSessionRoute
} from "./helpers";
import type { UseDashboardRouteScrollResetArgs } from "./types";

export function useDashboardRouteScrollReset({
  isExitingToDashboardFrame,
  routeState,
  setIsExitingToDashboardFrame
}: UseDashboardRouteScrollResetArgs) {
  const {
    agentSessionId,
    kind,
    sessionId,
    tab
  } = routeState;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!shouldResetWindowScrollOnSessionRoute({ agentSessionId, kind, tab })) return;

    resetWindowScroll();

    window.requestAnimationFrame(() => {
      resetWindowScroll();
    });
    const timeoutId = window.setTimeout(resetWindowScroll, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [agentSessionId, kind, sessionId, tab]);

  useEffect(() => {
    if (typeof window === "undefined" || kind !== "dashboard") return;

    if (!agentSessionId && isExitingToDashboardFrame) setIsExitingToDashboardFrame(false);

    if (!agentSessionId) {
      const rememberedScrollTop = consumeAgentBrowserListScrollTop();

      if (rememberedScrollTop !== null) {
        restoreWindowScroll(rememberedScrollTop);
        const frameId = window.requestAnimationFrame(() => {
          restoreWindowScroll(rememberedScrollTop);
        });
        const timeoutId = window.setTimeout(() => {
          restoreWindowScroll(rememberedScrollTop);
        }, 120);

        return () => {
          window.cancelAnimationFrame(frameId);
          window.clearTimeout(timeoutId);
        };
      }

      resetWindowScroll();
      const frameId = window.requestAnimationFrame(() => {
        resetWindowScroll();
      });

      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }
  }, [agentSessionId, isExitingToDashboardFrame, kind, setIsExitingToDashboardFrame]);
}
