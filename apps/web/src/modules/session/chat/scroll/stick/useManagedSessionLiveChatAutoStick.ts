import {
  useEffect,
  useLayoutEffect
} from "react";

import { isLiveOverviewChat } from "./helpers";
import type {
  ChatAutoStickRefs,
  LiveChatAutoStickState,
  SyncBottom
} from "./types";

export function useManagedSessionLiveChatAutoStick({
  activeTab,
  allowAutoStickReleaseRef,
  bottomStickKey,
  chatThreadRef,
  conversationTimelineLength,
  effectiveIsWaitingForChatReply,
  liveChatSessionId,
  liveChatSourceSessionId,
  mobileChatViewportMetrics,
  outgoingPromptKey,
  shouldStickPageToBottomRef,
  shouldStickToBottomRef,
  syncBottom,
  updateShowScrollToLatest,
  usePageScrollForChat,
  visibleTimelineLimit
}: LiveChatAutoStickState &
  ChatAutoStickRefs & {
    bottomStickKey: string;
    isCompactViewport: boolean;
    syncBottom: SyncBottom;
    updateShowScrollToLatest: (nextValue: boolean) => void;
  }) {
  useLayoutEffect(() => {
    if (!isLiveOverviewChat(activeTab, liveChatSourceSessionId)) {
      return;
    }

    shouldStickToBottomRef.current = true;
    shouldStickPageToBottomRef.current = true;
    allowAutoStickReleaseRef.current = false;
    updateShowScrollToLatest(false);
  }, [
    activeTab,
    allowAutoStickReleaseRef,
    liveChatSessionId,
    liveChatSourceSessionId,
    shouldStickPageToBottomRef,
    shouldStickToBottomRef,
    updateShowScrollToLatest
  ]);

  useEffect(() => {
    if (
      !isLiveOverviewChat(activeTab, liveChatSourceSessionId) ||
      usePageScrollForChat ||
      !shouldStickToBottomRef.current
    ) {
      return;
    }

    if (!chatThreadRef.current) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      if (!shouldStickToBottomRef.current) {
        return;
      }

      syncBottom({ syncMobilePage: false });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    activeTab,
    chatThreadRef,
    conversationTimelineLength,
    effectiveIsWaitingForChatReply,
    outgoingPromptKey,
    liveChatSourceSessionId,
    shouldStickToBottomRef,
    syncBottom,
    usePageScrollForChat,
    visibleTimelineLimit
  ]);

  useLayoutEffect(() => {
    if (!isLiveOverviewChat(activeTab, liveChatSourceSessionId)) {
      return;
    }

    let settleAnimationFrameId: number | null = null;
    const animationFrameId = window.requestAnimationFrame(() => {
      if (!shouldStickToBottomRef.current) {
        return;
      }

      syncBottom({ syncMobilePage: usePageScrollForChat });

      settleAnimationFrameId = window.requestAnimationFrame(() => {
        if (!shouldStickToBottomRef.current) {
          return;
        }

        syncBottom({ syncMobilePage: usePageScrollForChat });
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      if (settleAnimationFrameId !== null) {
        window.cancelAnimationFrame(settleAnimationFrameId);
      }
    };
  }, [
    activeTab,
    bottomStickKey,
    conversationTimelineLength,
    effectiveIsWaitingForChatReply,
    outgoingPromptKey,
    liveChatSourceSessionId,
    mobileChatViewportMetrics.composerHeight,
    mobileChatViewportMetrics.toolbarHeight,
    shouldStickToBottomRef,
    syncBottom,
    usePageScrollForChat
  ]);
}
