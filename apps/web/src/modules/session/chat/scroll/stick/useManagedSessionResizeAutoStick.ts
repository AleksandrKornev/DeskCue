import { useEffect } from "react";

import { shouldShowScrollToLatest } from "@modules/session/chat/scroll/helpers";
import type { ChatScrollMetrics } from "@modules/session/chat/scroll/types";

import { isLiveOverviewChat } from "./helpers";
import type { ChatAutoStickRefs } from "./types";

export function useManagedSessionResizeAutoStick({
  activeTab,
  chatThreadRef,
  bottomStickKey,
  conversationTimelineLength,
  getFreshChatScrollMetrics,
  liveChatSourceSessionId,
  shouldStickToBottomRef,
  syncBottomIfSticky,
  updateShowScrollToLatest,
  usePageScrollForChat,
  visibleTimelineLimit
}: Pick<ChatAutoStickRefs, "chatThreadRef" | "shouldStickToBottomRef"> & {
  activeTab: string;
  bottomStickKey: string;
  conversationTimelineLength: number;
  getFreshChatScrollMetrics: () => ChatScrollMetrics | null;
  liveChatSourceSessionId: string;
  syncBottomIfSticky: () => void;
  updateShowScrollToLatest: (nextValue: boolean) => void;
  usePageScrollForChat: boolean;
  visibleTimelineLimit: number;
}) {
  useEffect(() => {
    if (
      typeof ResizeObserver === "undefined" ||
      !isLiveOverviewChat(activeTab, liveChatSourceSessionId) ||
      usePageScrollForChat
    ) {
      return;
    }

    const element = chatThreadRef.current;
    if (!element) {
      return;
    }

    let animationFrameId: number | null = null;
    const syncScrollState = () => {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        if (shouldStickToBottomRef.current) {
          syncBottomIfSticky();
        }

        const metrics = getFreshChatScrollMetrics();
        if (!metrics) {
          return;
        }

        const shouldShow = shouldShowScrollToLatest(metrics);
        shouldStickToBottomRef.current = !shouldShow;
        updateShowScrollToLatest(shouldShow);
      });
    };

    const resizeObserver = new ResizeObserver(syncScrollState);
    resizeObserver.observe(element);

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(syncScrollState);
    mutationObserver?.observe(element, {
      childList: true,
      characterData: true,
      subtree: true
    });

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
    };
  }, [
    activeTab,
    bottomStickKey,
    chatThreadRef,
    conversationTimelineLength,
    getFreshChatScrollMetrics,
    liveChatSourceSessionId,
    shouldStickToBottomRef,
    syncBottomIfSticky,
    updateShowScrollToLatest,
    usePageScrollForChat,
    visibleTimelineLimit
  ]);
}
