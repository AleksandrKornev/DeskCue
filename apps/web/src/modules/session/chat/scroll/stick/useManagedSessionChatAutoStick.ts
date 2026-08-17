import {
  useCallback,
  useRef
} from "react";
import type {
  MutableRefObject,
  RefObject
} from "react";

import type { PendingChatPrompt } from "@models/promptDelivery";
import { shouldShowScrollToLatest } from "@modules/session/chat/scroll/helpers";
import type {
  ChatScrollMetrics,
  MobileChatViewportMetrics
} from "@modules/session/chat/scroll/types";

import {
  syncChatToBottom,
  syncChatToBottomIfSticky
} from "./helpers";
import { useManagedSessionLiveChatAutoStick } from "./useManagedSessionLiveChatAutoStick";
import { useManagedSessionOutgoingPromptAutoStick } from "./useManagedSessionOutgoingPromptAutoStick";
import { useManagedSessionResizeAutoStick } from "./useManagedSessionResizeAutoStick";
import { useManagedSessionSettleAutoStick } from "./useManagedSessionSettleAutoStick";

export function useManagedSessionChatAutoStick({
  activeTab,
  bottomStickKey,
  chatThreadRef,
  conversationTimelineLength,
  effectiveIsWaitingForChatReply,
  effectivePendingChatPrompt,
  getFreshChatScrollMetrics,
  isCompactViewport,
  liveChatSessionId,
  liveChatSourceSessionId,
  mobileChatViewportMetrics,
  scrollChatToBottom,
  setChatScrollTop,
  shouldStickPageToBottomRef,
  shouldStickToBottomRef,
  allowAutoStickReleaseRef,
  syncMobilePageToChatBottom,
  updateShowScrollToLatest,
  usePageScrollForChat,
  visibleTimelineLimit
}: {
  activeTab: string;
  bottomStickKey: string;
  chatThreadRef: RefObject<HTMLDivElement | null>;
  conversationTimelineLength: number;
  effectiveIsWaitingForChatReply: boolean;
  effectivePendingChatPrompt: PendingChatPrompt | null;
  getFreshChatScrollMetrics: () => ChatScrollMetrics | null;
  isCompactViewport: boolean;
  liveChatSessionId: string;
  liveChatSourceSessionId: string;
  mobileChatViewportMetrics: MobileChatViewportMetrics;
  scrollChatToBottom: () => void;
  setChatScrollTop: (nextScrollTop: number) => void;
  shouldStickPageToBottomRef: MutableRefObject<boolean>;
  shouldStickToBottomRef: MutableRefObject<boolean>;
  allowAutoStickReleaseRef: MutableRefObject<boolean>;
  syncMobilePageToChatBottom: () => void;
  updateShowScrollToLatest: (nextValue: boolean) => void;
  usePageScrollForChat: boolean;
  visibleTimelineLimit: number;
}) {
  const lastOutgoingPromptKeyRef = useRef("");
  const syncBottom = useCallback((options?: { syncMobilePage?: boolean }) => {
    syncChatToBottom({
      scrollChatToBottom,
      syncMobilePage: options?.syncMobilePage,
      syncMobilePageToChatBottom,
      updateShowScrollToLatest
    });
  }, [scrollChatToBottom, syncMobilePageToChatBottom, updateShowScrollToLatest]);
  const syncInnerBottomIfSticky = useCallback(() => {
    syncChatToBottomIfSticky({
      chatThreadRef,
      scrollChatToBottom,
      shouldStickToBottomRef,
      syncMobilePage: false,
      syncMobilePageToChatBottom,
      updateShowScrollToLatest
    });
  }, [
    chatThreadRef,
    scrollChatToBottom,
    shouldStickToBottomRef,
    syncMobilePageToChatBottom,
    updateShowScrollToLatest
  ]);

  const scrollChatToLatest = () => {
    const metrics = getFreshChatScrollMetrics();
    if (!metrics) {
      return;
    }

    setChatScrollTop(metrics.scrollHeight);
    shouldStickPageToBottomRef.current = true;
    window.requestAnimationFrame(syncMobilePageToChatBottom);
    shouldStickToBottomRef.current = true;
    updateShowScrollToLatest(false);

    window.requestAnimationFrame(() => {
      const settledMetrics = getFreshChatScrollMetrics();
      if (!settledMetrics || shouldShowScrollToLatest(settledMetrics)) {
        return;
      }

      shouldStickToBottomRef.current = true;
      updateShowScrollToLatest(false);
    });
  };

  const forceChatToLatest = useCallback(() => {
    shouldStickToBottomRef.current = true;
    shouldStickPageToBottomRef.current = true;
    updateShowScrollToLatest(false);

    window.requestAnimationFrame(() => {
      syncBottom();

      window.requestAnimationFrame(() => {
        syncBottom();
      });
    });
  }, [
    shouldStickPageToBottomRef,
    shouldStickToBottomRef,
    syncBottom,
    updateShowScrollToLatest
  ]);

  const outgoingPromptKey = effectivePendingChatPrompt
    ? `${effectivePendingChatPrompt.requestedAt}:${effectivePendingChatPrompt.text}`
    : "";

  useManagedSessionOutgoingPromptAutoStick({
    activeTab,
    forceChatToLatest,
    lastOutgoingPromptKeyRef,
    liveChatSourceSessionId,
    outgoingPromptKey
  });

  useManagedSessionLiveChatAutoStick({
    activeTab,
    allowAutoStickReleaseRef,
    bottomStickKey,
    chatThreadRef,
    conversationTimelineLength,
    effectiveIsWaitingForChatReply,
    isCompactViewport,
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
  });

  useManagedSessionResizeAutoStick({
    activeTab,
    bottomStickKey,
    chatThreadRef,
    conversationTimelineLength,
    getFreshChatScrollMetrics,
    liveChatSourceSessionId,
    shouldStickToBottomRef,
    syncBottomIfSticky: syncInnerBottomIfSticky,
    updateShowScrollToLatest,
    usePageScrollForChat,
    visibleTimelineLimit
  });

  useManagedSessionSettleAutoStick({
    activeTab,
    allowAutoStickReleaseRef,
    bottomStickKey,
    chatThreadRef,
    conversationTimelineLength,
    liveChatSourceSessionId,
    mobileChatViewportMetrics,
    shouldSettleAfterContentChange:
      effectiveIsWaitingForChatReply || Boolean(effectivePendingChatPrompt),
    syncBottomIfSticky: syncInnerBottomIfSticky,
    usePageScrollForChat,
    visibleTimelineLimit
  });

  return {
    scrollChatToLatest
  };
}
