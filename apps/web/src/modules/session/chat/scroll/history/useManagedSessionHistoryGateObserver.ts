import { useEffect } from "react";
import type {
  MutableRefObject,
  RefObject
} from "react";

import {
  CHAT_HISTORY_AUTO_LOAD_IDLE_DELAY_MS,
  CHAT_HISTORY_LOAD_THRESHOLD_PX
} from "@modules/session/chat/scroll/constants";
import type { ChatScrollMetrics } from "@modules/session/chat/scroll/types";

export function useManagedSessionHistoryGateObserver({
  activeTab,
  canRevealEarlierHistory,
  chatThreadRef,
  conversationTimelineLength,
  getChatScrollMetrics,
  historyAutoLoadArmedRef,
  hiddenConversationItemCount,
  isLoadingMoreHistory,
  liveChatSourceSessionId,
  loadEarlierHistoryFromMetrics,
  updateHistoryAutoLoadPending,
  usePageScrollForChat,
  visibleTimelineLimit
}: {
  activeTab: string;
  canRevealEarlierHistory: boolean;
  chatThreadRef: RefObject<HTMLDivElement | null>;
  conversationTimelineLength: number;
  getChatScrollMetrics: () => ChatScrollMetrics | null;
  historyAutoLoadArmedRef: MutableRefObject<boolean>;
  hiddenConversationItemCount: number;
  isLoadingMoreHistory: boolean;
  liveChatSourceSessionId: string | null;
  loadEarlierHistoryFromMetrics: (metrics: ChatScrollMetrics) => boolean;
  updateHistoryAutoLoadPending: (nextValue: boolean) => void;
  usePageScrollForChat: boolean;
  visibleTimelineLimit: number;
}) {
  useEffect(() => {
    if (
      !liveChatSourceSessionId ||
      activeTab !== "overview" ||
      !canRevealEarlierHistory ||
      isLoadingMoreHistory
    ) {
      return;
    }

    const container = chatThreadRef.current;
    const historyGate = container?.querySelector<HTMLElement>("[data-chat-history-gate]");
    if (!container || !historyGate) {
      return;
    }

    let autoLoadTimeoutId: number | null = null;
    const clearScheduledAutoLoad = () => {
      if (autoLoadTimeoutId === null) {
        return;
      }

      window.clearTimeout(autoLoadTimeoutId);
      autoLoadTimeoutId = null;
      updateHistoryAutoLoadPending(false);
    };

    const loadIfNearHistoryGate = () => {
      const metrics = getChatScrollMetrics();
      if (
        !metrics ||
        metrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX ||
        !historyAutoLoadArmedRef.current
      ) {
        return false;
      }

      return loadEarlierHistoryFromMetrics(metrics);
    };

    const scheduleLoadIfGateIsVisible = () => {
      const scheduledMetrics = getChatScrollMetrics();
      if (
        !scheduledMetrics ||
        scheduledMetrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX ||
        !historyAutoLoadArmedRef.current
      ) {
        clearScheduledAutoLoad();
        return;
      }

      const scheduledScrollTop = scheduledMetrics.scrollTop;
      clearScheduledAutoLoad();
      updateHistoryAutoLoadPending(true);
      autoLoadTimeoutId = window.setTimeout(() => {
        autoLoadTimeoutId = null;
        const nextMetrics = getChatScrollMetrics();
        if (
          !nextMetrics ||
          Math.abs(nextMetrics.scrollTop - scheduledScrollTop) > 2
        ) {
          updateHistoryAutoLoadPending(false);
          return;
        }

        loadIfNearHistoryGate();
        updateHistoryAutoLoadPending(false);
      }, CHAT_HISTORY_AUTO_LOAD_IDLE_DELAY_MS);
    };

    const animationFrameId = window.requestAnimationFrame(scheduleLoadIfGateIsVisible);

    if (typeof IntersectionObserver === "undefined") {
      return () => {
        window.cancelAnimationFrame(animationFrameId);
        clearScheduledAutoLoad();
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          scheduleLoadIfGateIsVisible();
        }
      },
      {
        root: usePageScrollForChat ? null : container,
        threshold: 0.01
      }
    );
    observer.observe(historyGate);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      clearScheduledAutoLoad();
      observer.disconnect();
    };
  }, [
    activeTab,
    canRevealEarlierHistory,
    chatThreadRef,
    conversationTimelineLength,
    getChatScrollMetrics,
    historyAutoLoadArmedRef,
    hiddenConversationItemCount,
    isLoadingMoreHistory,
    loadEarlierHistoryFromMetrics,
    liveChatSourceSessionId,
    updateHistoryAutoLoadPending,
    usePageScrollForChat,
    visibleTimelineLimit
  ]);
}
