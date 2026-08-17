import { useEffect } from "react";

import type { UseManagedSessionMobilePageScrollEffectsArgs } from "./types";

export function useManagedSessionMobilePageScrollEffects({
  activeTab,
  isCompactViewport,
  liveChatSourceSessionId,
  programmaticPageScrollRef,
  shouldStickPageToBottomRef,
  shouldStickToBottomRef,
  syncMobilePageToChatBottom
}: UseManagedSessionMobilePageScrollEffectsArgs) {
  useEffect(() => {
    if (
      !isCompactViewport ||
      !liveChatSourceSessionId ||
      activeTab !== "overview"
    ) {
      return;
    }

    const pendingTimeoutIds = new Set<number>();
    const scheduleBottomSync = () => {
      if (!shouldStickToBottomRef.current || !shouldStickPageToBottomRef.current) {
        return;
      }

      const delays = [0, 80, 220];
      delays.forEach((delay) => {
        const timeoutId = window.setTimeout(() => {
          pendingTimeoutIds.delete(timeoutId);
          window.requestAnimationFrame(syncMobilePageToChatBottom);
        }, delay);
        pendingTimeoutIds.add(timeoutId);
      });
    };

    window.addEventListener("resize", scheduleBottomSync);
    document.addEventListener("focusout", scheduleBottomSync);

    return () => {
      window.removeEventListener("resize", scheduleBottomSync);
      document.removeEventListener("focusout", scheduleBottomSync);
      pendingTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      pendingTimeoutIds.clear();
    };
  }, [
    activeTab,
    isCompactViewport,
    liveChatSourceSessionId,
    shouldStickPageToBottomRef,
    shouldStickToBottomRef,
    syncMobilePageToChatBottom
  ]);

  useEffect(() => {
    if (
      !isCompactViewport ||
      !liveChatSourceSessionId ||
      activeTab !== "overview"
    ) {
      return;
    }

    const handleWindowScroll = () => {
      if (programmaticPageScrollRef.current) {
        return;
      }

      shouldStickPageToBottomRef.current = false;
    };

    window.addEventListener("wheel", handleWindowScroll, { passive: true });
    window.addEventListener("scroll", handleWindowScroll, { passive: true });

    return () => {
      window.removeEventListener("wheel", handleWindowScroll);
      window.removeEventListener("scroll", handleWindowScroll);
    };
  }, [
    activeTab,
    isCompactViewport,
    liveChatSourceSessionId,
    programmaticPageScrollRef,
    shouldStickPageToBottomRef
  ]);
}
