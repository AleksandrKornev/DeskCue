import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { CSSProperties } from "react";

import type { ChatScrollOptions } from "@modules/session/chat/scroll/types";

import { HISTORY_AUTO_LOAD_PENDING_MIN_MS } from "./constants";
import { useManagedSessionChatHistoryExpansion } from "./history/useManagedSessionChatHistoryExpansion";
import { useManagedSessionHistoryGateObserver } from "./history/useManagedSessionHistoryGateObserver";
import { useManagedSessionVisibleTimeline } from "./history/useManagedSessionVisibleTimeline";
import { useManagedSessionMobilePageScrollEffects } from "./mobile/useManagedSessionMobilePageScrollEffects";
import { useManagedSessionMobilePageSync } from "./mobile/useManagedSessionMobilePageSync";
import { useManagedSessionNativeScrollListener } from "./mobile/useManagedSessionNativeScrollListener";
import { useManagedSessionChatAutoStick } from "./stick/useManagedSessionChatAutoStick";
import { useManagedSessionChatScrollTarget } from "./useManagedSessionChatScrollTarget";
import { useCompactChatViewport } from "./viewport/useCompactChatViewport";
import { useMobileChatViewportMetrics } from "./viewport/useMobileChatViewportMetrics";

export function useManagedSessionChatScroll({
  activeTab,
  bottomStickKey,
  canLoadMoreHistory,
  conversationTimeline,
  effectiveIsWaitingForChatReply,
  effectivePendingChatPrompt,
  isLoadingMoreHistory,
  isTakenOverChat,
  liveChatSessionId,
  liveChatSourceSessionId,
  onLoadMoreHistory,
  resetKey
}: ChatScrollOptions) {
  const chatThreadRef = useRef<HTMLDivElement | null>(null);
  const chatToolbarRef = useRef<HTMLDivElement | null>(null);
  const chatComposerShellRef = useRef<HTMLDivElement | null>(null);
  const chatSurfaceRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const shouldStickPageToBottomRef = useRef(true);
  const allowAutoStickReleaseRef = useRef(false);
  const isCompactViewport = useCompactChatViewport();
  const mobileChatViewportMetrics = useMobileChatViewportMetrics({
    activeTab,
    chatComposerShellRef,
    chatToolbarRef,
    isCompactViewport,
    isTakenOverChat
  });

  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const {
    conversationMessageCount,
    expandVisibleTimelineLimit,
    firstLoadedMessageId,
    hiddenConversationItemCount,
    visibleConversationTimeline,
    visibleTimelineLimit
  } = useManagedSessionVisibleTimeline({
    activeTab,
    conversationTimeline,
    liveChatSourceSessionId,
    resetKey
  });
  const updateShowScrollToLatest = useCallback((nextValue: boolean) => {
    setShowScrollToLatest((currentValue) =>
      currentValue === nextValue ? currentValue : nextValue
    );
  }, []);
  const [isHistoryAutoLoadPending, setIsHistoryAutoLoadPending] = useState(false);
  const historyAutoLoadPendingStartedAtRef = useRef<number | null>(null);
  const historyAutoLoadPendingClearTimeoutRef = useRef<number | null>(null);
  const clearHistoryAutoLoadPendingTimeout = useCallback(() => {
    if (historyAutoLoadPendingClearTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(historyAutoLoadPendingClearTimeoutRef.current);
    historyAutoLoadPendingClearTimeoutRef.current = null;
  }, []);
  const updateHistoryAutoLoadPending = useCallback((nextValue: boolean) => {
    clearHistoryAutoLoadPendingTimeout();

    if (nextValue) {
      historyAutoLoadPendingStartedAtRef.current ??= performance.now();
      setIsHistoryAutoLoadPending((currentValue) =>
        currentValue ? currentValue : true
      );
      return;
    }

    const startedAt = historyAutoLoadPendingStartedAtRef.current;
    if (startedAt === null) {
      setIsHistoryAutoLoadPending(false);
      return;
    }

    const remainingMs =
      HISTORY_AUTO_LOAD_PENDING_MIN_MS - (performance.now() - startedAt);
    if (remainingMs > 0) {
      historyAutoLoadPendingClearTimeoutRef.current = window.setTimeout(() => {
        historyAutoLoadPendingClearTimeoutRef.current = null;
        historyAutoLoadPendingStartedAtRef.current = null;
        setIsHistoryAutoLoadPending(false);
      }, remainingMs);
      return;
    }

    historyAutoLoadPendingStartedAtRef.current = null;
    setIsHistoryAutoLoadPending(false);
  }, [clearHistoryAutoLoadPendingTimeout]);

  useEffect(() => () => {
    clearHistoryAutoLoadPendingTimeout();
  }, [clearHistoryAutoLoadPendingTimeout]);

  const usePageScrollForChat = false;
  const chatWorkspaceStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isCompactViewport || !isTakenOverChat) {
      return undefined;
    }

    return {
      "--chat-composer-height": `${mobileChatViewportMetrics.composerHeight}px`,
      "--chat-toolbar-height": `${mobileChatViewportMetrics.toolbarHeight}px`,
      "--chat-toolbar-sticky-offset": `${mobileChatViewportMetrics.stickyOffset}px`
    } as CSSProperties;
  }, [
    isCompactViewport,
    isTakenOverChat,
    mobileChatViewportMetrics.composerHeight,
    mobileChatViewportMetrics.stickyOffset,
    mobileChatViewportMetrics.toolbarHeight
  ]);
  const {
    getFreshChatScrollMetrics,
    getChatScrollMetrics,
    scrollChatToBottom,
    setChatScrollTop
  } = useManagedSessionChatScrollTarget({
    chatThreadRef,
    usePageScrollForChat
  });
  const {
    canRevealEarlierHistory,
    historyAutoLoadArmedRef,
    historyAutoLoadRearmBlockedUntilRef,
    isRevealingEarlierHistory,
    loadEarlierHistoryFromMetrics,
    pendingHistoryExpansionRef,
    revealEarlierHistory
  } = useManagedSessionChatHistoryExpansion({
    activeTab,
    canLoadMoreHistory,
    chatThreadRef,
    conversationMessageCount,
    conversationTimelineLength: conversationTimeline.length,
    expandVisibleTimelineLimit,
    firstLoadedMessageId,
    getFreshChatScrollMetrics,
    hiddenConversationItemCount,
    isLoadingMoreHistory,
    liveChatSessionId,
    liveChatSourceSessionId,
    onLoadMoreHistory,
    resetKey,
    usePageScrollForChat,
    visibleTimelineLimit
  });
  const isHistoryLoading =
    isLoadingMoreHistory ||
    isRevealingEarlierHistory ||
    isHistoryAutoLoadPending;
  const {
    programmaticPageScrollRef,
    syncMobilePageToChatBottom
  } = useManagedSessionMobilePageSync({
    chatSurfaceRef,
    chatThreadRef,
    chatToolbarRef,
    isCompactViewport,
    scrollChatToBottom,
    shouldStickPageToBottomRef,
    shouldStickToBottomRef,
    usePageScrollForChat
  });

  const { scrollChatToLatest } = useManagedSessionChatAutoStick({
    activeTab,
    allowAutoStickReleaseRef,
    bottomStickKey,
    chatThreadRef,
    conversationTimelineLength: conversationTimeline.length,
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
    syncMobilePageToChatBottom,
    updateShowScrollToLatest,
    usePageScrollForChat,
    visibleTimelineLimit
  });

  useManagedSessionMobilePageScrollEffects({
    activeTab,
    isCompactViewport,
    liveChatSourceSessionId,
    programmaticPageScrollRef,
    shouldStickPageToBottomRef,
    shouldStickToBottomRef,
    syncMobilePageToChatBottom
  });

  useManagedSessionNativeScrollListener({
    activeTab,
    allowAutoStickReleaseRef,
    canRevealEarlierHistory,
    chatThreadRef,
    getChatScrollMetrics,
    getFreshChatScrollMetrics,
    historyAutoLoadArmedRef,
    historyAutoLoadRearmBlockedUntilRef,
    loadEarlierHistoryFromMetrics,
    liveChatSourceSessionId,
    pendingHistoryExpansionRef,
    shouldStickToBottomRef,
    updateHistoryAutoLoadPending,
    updateShowScrollToLatest,
    usePageScrollForChat
  });

  useManagedSessionHistoryGateObserver({
    activeTab,
    canRevealEarlierHistory,
    chatThreadRef,
    conversationTimelineLength: conversationTimeline.length,
    getChatScrollMetrics,
    historyAutoLoadArmedRef,
    hiddenConversationItemCount,
    isLoadingMoreHistory,
    loadEarlierHistoryFromMetrics,
    liveChatSourceSessionId,
    updateHistoryAutoLoadPending,
    usePageScrollForChat,
    visibleTimelineLimit
  });

  return {
    chatComposerShellRef,
    chatSurfaceRef,
    chatThreadRef,
    chatToolbarRef,
    chatWorkspaceStyle,
    canRevealEarlierHistory,
    hiddenConversationItemCount,
    isLoadingMoreHistory: isHistoryLoading,
    isCompactViewport,
    revealEarlierHistory,
    scrollChatToLatest,
    showScrollToLatest,
    visibleConversationTimeline
  };
}
