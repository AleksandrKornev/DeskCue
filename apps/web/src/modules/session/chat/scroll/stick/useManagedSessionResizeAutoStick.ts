import { useEffect } from "react";

import { shouldShowScrollToLatest } from "@modules/session/chat/scroll/helpers";
import type { ChatScrollMetrics } from "@modules/session/chat/scroll/types";

import { isLiveOverviewChat } from "./helpers";
import type { ChatAutoStickRefs } from "./types";

export function shouldShowScrollToLatestAfterResize(
  metrics: ChatScrollMetrics,
  shouldStickToBottom: boolean
) {
  return !shouldStickToBottom && shouldShowScrollToLatest(metrics);
}

type ManagedSessionResizeAutoStickObserverOptions = {
  element: HTMLDivElement;
  getFreshChatScrollMetrics: () => ChatScrollMetrics | null;
  shouldStickToBottomRef: ChatAutoStickRefs["shouldStickToBottomRef"];
  syncBottomIfSticky: () => void;
  updateShowScrollToLatest: (nextValue: boolean) => void;
};

class ManagedSessionResizeAutoStickObserver {
  private animationFrameId: number | null = null;
  private readonly mutationObserver: MutationObserver | null;
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly options: ManagedSessionResizeAutoStickObserverOptions) {
    this.resizeObserver = new ResizeObserver(this.scheduleSync);
    this.resizeObserver.observe(options.element);
    this.mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(this.scheduleSync);
    this.mutationObserver?.observe(options.element, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  dispose() {
    if (this.animationFrameId !== null) window.cancelAnimationFrame(this.animationFrameId);

    this.resizeObserver.disconnect();
    this.mutationObserver?.disconnect();
  }

  private readonly scheduleSync = () => {
    if (this.animationFrameId !== null) return;

    this.animationFrameId = window.requestAnimationFrame(() => {
      this.animationFrameId = null;
      if (this.options.shouldStickToBottomRef.current) {
        this.options.syncBottomIfSticky();
        this.options.updateShowScrollToLatest(false);
        return;
      }

      const metrics = this.options.getFreshChatScrollMetrics();

      if (!metrics) return;

      this.options.updateShowScrollToLatest(
        shouldShowScrollToLatestAfterResize(
          metrics,
          this.options.shouldStickToBottomRef.current
        )
      );
    });
  };
}

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

    if (!element) return;

    const observer = new ManagedSessionResizeAutoStickObserver({
      element,
      getFreshChatScrollMetrics,
      shouldStickToBottomRef,
      syncBottomIfSticky,
      updateShowScrollToLatest
    });

    return () => {
      observer.dispose();
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
