import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";

import {
  CHAT_HISTORY_AUTO_LOAD_REARM_DELAY_MS,
  CHAT_HISTORY_LOAD_THRESHOLD_PX
} from "@modules/session/chat/scroll/constants";
import {
  captureChatHistoryAnchor,
  resolveAnchoredHistoryScrollTop
} from "@modules/session/chat/scroll/helpers";
import type {
  ChatHistoryAnchor,
  ChatScrollMetrics
} from "@modules/session/chat/scroll/types";

import { LOCAL_HISTORY_REVEAL_INDICATOR_MS } from "./constants";
import type { UseManagedSessionChatHistoryExpansionArgs } from "./types";

export function useManagedSessionChatHistoryExpansion({
  activeTab,
  canLoadMoreHistory,
  chatThreadRef,
  conversationMessageCount,
  conversationTimelineLength,
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
}: UseManagedSessionChatHistoryExpansionArgs) {
  const historyAutoLoadArmedRef = useRef(true);
  const historyAutoLoadRearmBlockedUntilRef = useRef(0);
  const historyExpansionInFlightRef = useRef(false);
  const historyExpansionGenerationRef = useRef(0);
  const pendingHistoryExpansionRef = useRef<ChatHistoryAnchor | null>(null);
  const localRevealIndicatorTimeoutRef = useRef<number | null>(null);
  const [isRevealingEarlierHistory, setIsRevealingEarlierHistory] = useState(false);
  const canRevealEarlierHistory =
    hiddenConversationItemCount > 0 ||
    (canLoadMoreHistory && !isLoadingMoreHistory && Boolean(firstLoadedMessageId));

  const clearLocalRevealIndicator = useCallback(() => {
    if (localRevealIndicatorTimeoutRef.current !== null) {
      window.clearTimeout(localRevealIndicatorTimeoutRef.current);
      localRevealIndicatorTimeoutRef.current = null;
    }

    setIsRevealingEarlierHistory(false);
  }, []);

  const showLocalRevealIndicator = useCallback(() => {
    clearLocalRevealIndicator();
    setIsRevealingEarlierHistory(true);
    localRevealIndicatorTimeoutRef.current = window.setTimeout(() => {
      localRevealIndicatorTimeoutRef.current = null;
      setIsRevealingEarlierHistory(false);
    }, LOCAL_HISTORY_REVEAL_INDICATOR_MS);
  }, [clearLocalRevealIndicator]);

  const settleHistoryAnchorAfterRender = useCallback((generation: number) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (generation !== historyExpansionGenerationRef.current) {
          return;
        }
        const pendingAnchor = pendingHistoryExpansionRef.current;
        if (!pendingAnchor) {
          return;
        }

        const metrics = getFreshChatScrollMetrics();
        if (metrics && metrics.scrollHeight > pendingAnchor.previousScrollHeight) {
          if (usePageScrollForChat) {
            window.scrollTo({
              top: resolveAnchoredHistoryScrollTop({
                anchor: pendingAnchor,
                container: chatThreadRef.current,
                metrics,
                usePageScrollForChat
              })
            });
          } else if (chatThreadRef.current) {
            chatThreadRef.current.scrollTop = resolveAnchoredHistoryScrollTop({
              anchor: pendingAnchor,
              container: chatThreadRef.current,
              metrics,
              usePageScrollForChat
            });
          }
        }

        pendingHistoryExpansionRef.current = null;
      });
    });
  }, [chatThreadRef, getFreshChatScrollMetrics, usePageScrollForChat]);

  const captureHistoryAnchor = useCallback((metrics: ChatScrollMetrics) => {
    return captureChatHistoryAnchor({
      container: chatThreadRef.current,
      conversationMessageCount,
      metrics,
      usePageScrollForChat
    });
  }, [chatThreadRef, conversationMessageCount, usePageScrollForChat]);

  const loadEarlierHistoryFromMetrics = useCallback((metrics: ChatScrollMetrics) => {
    if (
      (!canRevealEarlierHistory && !isLoadingMoreHistory) ||
      historyExpansionInFlightRef.current
    ) {
      return false;
    }

    historyExpansionInFlightRef.current = true;
    const generation = historyExpansionGenerationRef.current;
    historyAutoLoadArmedRef.current = false;
    historyAutoLoadRearmBlockedUntilRef.current =
      performance.now() + CHAT_HISTORY_AUTO_LOAD_REARM_DELAY_MS;
    pendingHistoryExpansionRef.current = captureHistoryAnchor(
      getFreshChatScrollMetrics() ?? metrics
    );

    if (hiddenConversationItemCount > 0) {
      showLocalRevealIndicator();
      expandVisibleTimelineLimit();
      window.requestAnimationFrame(() => {
        if (generation === historyExpansionGenerationRef.current) {
          historyExpansionInFlightRef.current = false;
        }
      });
      return true;
    }

    if (canLoadMoreHistory && !isLoadingMoreHistory && firstLoadedMessageId) {
      void Promise.resolve(onLoadMoreHistory(firstLoadedMessageId))
        .then((loadedMessageCount) => {
          if (generation !== historyExpansionGenerationRef.current) {
            return;
          }
          if (loadedMessageCount > 0) {
            showLocalRevealIndicator();
            expandVisibleTimelineLimit(loadedMessageCount);
            settleHistoryAnchorAfterRender(generation);
            return;
          }

          pendingHistoryExpansionRef.current = null;
        })
        .catch(() => {
          if (generation === historyExpansionGenerationRef.current) {
            pendingHistoryExpansionRef.current = null;
          }
        })
        .finally(() => {
          if (generation === historyExpansionGenerationRef.current) {
            historyExpansionInFlightRef.current = false;
          }
        });
      return true;
    }

    pendingHistoryExpansionRef.current = null;
    historyExpansionInFlightRef.current = false;
    return false;
  }, [
    canLoadMoreHistory,
    canRevealEarlierHistory,
    captureHistoryAnchor,
    expandVisibleTimelineLimit,
    firstLoadedMessageId,
    getFreshChatScrollMetrics,
    hiddenConversationItemCount,
    isLoadingMoreHistory,
    onLoadMoreHistory,
    settleHistoryAnchorAfterRender,
    showLocalRevealIndicator
  ]);

  const revealEarlierHistory = () => {
    const metrics = getFreshChatScrollMetrics();
    if (!metrics || (!canRevealEarlierHistory && !isLoadingMoreHistory)) {
      return;
    }

    if (metrics.scrollTop <= CHAT_HISTORY_LOAD_THRESHOLD_PX) {
      historyAutoLoadArmedRef.current = false;
    }
    loadEarlierHistoryFromMetrics(metrics);
  };

  useEffect(() => {
    if (!liveChatSourceSessionId || activeTab !== "overview") {
      return;
    }

    historyAutoLoadArmedRef.current = true;
  }, [activeTab, liveChatSessionId, liveChatSourceSessionId]);

  // Reset stale anchors before the layout pass below can observe the next
  // session's DOM. A passive effect runs after layout and can otherwise apply
  // the previous chat's anchor to the newly selected chat.
  useLayoutEffect(() => {
    historyExpansionGenerationRef.current += 1;
    pendingHistoryExpansionRef.current = null;
    historyExpansionInFlightRef.current = false;
    historyAutoLoadArmedRef.current = true;
    historyAutoLoadRearmBlockedUntilRef.current = 0;
    clearLocalRevealIndicator();
  }, [clearLocalRevealIndicator, resetKey]);

  useLayoutEffect(() => {
    if (!liveChatSourceSessionId || activeTab !== "overview") {
      return;
    }

    const applyScrollTop = (nextScrollTop: number) => {
      if (usePageScrollForChat) {
        window.scrollTo({ top: nextScrollTop });
        return;
      }

      const element = chatThreadRef.current;
      if (element) {
        element.scrollTop = nextScrollTop;
      }
    };

    if (!pendingHistoryExpansionRef.current) {
      return;
    }

    const metrics = getFreshChatScrollMetrics();
    if (!metrics) {
      return;
    }
    const {
      previousConversationMessageCount,
      previousScrollHeight
    } = pendingHistoryExpansionRef.current;

    if (metrics.scrollHeight <= previousScrollHeight) {
      if (conversationMessageCount <= previousConversationMessageCount) {
        return;
      }

      pendingHistoryExpansionRef.current = null;
      return;
    }

    applyScrollTop(resolveAnchoredHistoryScrollTop({
      anchor: pendingHistoryExpansionRef.current,
      container: chatThreadRef.current,
      metrics,
      usePageScrollForChat
    }));

    pendingHistoryExpansionRef.current = null;
    historyExpansionInFlightRef.current = false;
  }, [
    activeTab,
    canLoadMoreHistory,
    chatThreadRef,
    conversationMessageCount,
    conversationTimelineLength,
    firstLoadedMessageId,
    getFreshChatScrollMetrics,
    hiddenConversationItemCount,
    isLoadingMoreHistory,
    loadEarlierHistoryFromMetrics,
    liveChatSourceSessionId,
    onLoadMoreHistory,
    usePageScrollForChat,
    visibleTimelineLimit
  ]);

  useEffect(() => () => {
    if (localRevealIndicatorTimeoutRef.current !== null) {
      window.clearTimeout(localRevealIndicatorTimeoutRef.current);
      localRevealIndicatorTimeoutRef.current = null;
    }
  }, []);

  return {
    canRevealEarlierHistory,
    historyAutoLoadArmedRef,
    historyAutoLoadRearmBlockedUntilRef,
    isRevealingEarlierHistory,
    loadEarlierHistoryFromMetrics,
    pendingHistoryExpansionRef,
    revealEarlierHistory
  };
}
