import { useEffect } from "react";
import type {
  MutableRefObject,
  RefObject
} from "react";

import type {
  ChatHistoryAnchor,
  ChatScrollMetrics
} from "@modules/session/chat/scroll/types";

import { browserNativeScrollScheduler } from "./helpers";
import { createManagedSessionNativeScrollController } from "./managedSessionNativeScrollController";
import { bindManagedSessionNativeScrollEvents } from "./nativeScrollEventBinding";

export {
  CHAT_USER_SCROLL_INTENT_WINDOW_MS,
  hasRecentChatUserScrollIntent,
  shouldKeepAutoStickForNativeScroll,
  shouldReleaseAutoStickForNativeScroll
} from "./managedSessionNativeScrollController";

export function useManagedSessionNativeScrollListener({
  activeTab,
  allowAutoStickReleaseRef,
  canRevealEarlierHistory,
  chatThreadRef,
  getChatScrollMetrics,
  getFreshChatScrollMetrics,
  historyAutoLoadArmedRef,
  historyAutoLoadRearmBlockedUntilRef,
  liveChatSourceSessionId,
  loadEarlierHistoryFromMetrics,
  pendingHistoryExpansionRef,
  updateShowScrollToLatest,
  updateHistoryAutoLoadPending,
  shouldStickToBottomRef,
  usePageScrollForChat
}: {
  activeTab: string;
  allowAutoStickReleaseRef: MutableRefObject<boolean>;
  canRevealEarlierHistory: boolean;
  chatThreadRef: RefObject<HTMLDivElement | null>;
  getChatScrollMetrics: () => ChatScrollMetrics | null;
  getFreshChatScrollMetrics: () => ChatScrollMetrics | null;
  historyAutoLoadArmedRef: MutableRefObject<boolean>;
  historyAutoLoadRearmBlockedUntilRef: MutableRefObject<number>;
  liveChatSourceSessionId: string | null;
  loadEarlierHistoryFromMetrics: (metrics: ChatScrollMetrics) => boolean;
  pendingHistoryExpansionRef: MutableRefObject<ChatHistoryAnchor | null>;
  shouldStickToBottomRef: MutableRefObject<boolean>;
  updateHistoryAutoLoadPending: (nextValue: boolean) => void;
  updateShowScrollToLatest: (nextValue: boolean) => void;
  usePageScrollForChat: boolean;
}) {
  useEffect(() => {
    if (!liveChatSourceSessionId || activeTab !== "overview") {
      return;
    }

    const scrollTarget: Window | HTMLDivElement | null = usePageScrollForChat
      ? window
      : chatThreadRef.current;
    if (!scrollTarget) {
      return;
    }

    const controller = createManagedSessionNativeScrollController({
      canRevealEarlierHistory,
      getAllowAutoStickRelease: () => allowAutoStickReleaseRef.current,
      getChatScrollMetrics,
      getFreshChatScrollMetrics,
      getHistoryAutoLoadArmed: () => historyAutoLoadArmedRef.current,
      getHistoryAutoLoadRearmBlockedUntil: () =>
        historyAutoLoadRearmBlockedUntilRef.current,
      getPendingHistoryExpansion: () =>
        pendingHistoryExpansionRef.current !== null,
      getShouldStickToBottom: () => shouldStickToBottomRef.current,
      loadEarlierHistoryFromMetrics,
      scheduler: browserNativeScrollScheduler,
      setAllowAutoStickRelease: (nextValue) => {
        allowAutoStickReleaseRef.current = nextValue;
      },
      setHistoryAutoLoadArmed: (nextValue) => {
        historyAutoLoadArmedRef.current = nextValue;
      },
      setShouldStickToBottom: (nextValue) => {
        shouldStickToBottomRef.current = nextValue;
      },
      updateHistoryAutoLoadPending,
      updateShowScrollToLatest
    });
    const unbindNativeScrollEvents = bindManagedSessionNativeScrollEvents({
      handlers: {
        onPointerDown: (event) => {
          controller.handlers.onPointerDown((event as PointerEvent).clientY);
        },
        onPointerEnd: controller.handlers.onPointerEnd,
        onPointerMove: (event) => {
          controller.handlers.onPointerMove((event as PointerEvent).clientY);
        },
        onScroll: controller.handlers.onScroll,
        onTouchEnd: controller.handlers.onTouchEnd,
        onTouchMove: (event) => {
          controller.handlers.onTouchMove(
            (event as TouchEvent).touches[0]?.clientY
          );
        },
        onTouchStart: (event) => {
          controller.handlers.onTouchStart(
            (event as TouchEvent).touches[0]?.clientY ?? null
          );
        },
        onWheel: (event) => {
          controller.handlers.onWheel((event as WheelEvent).deltaY);
        }
      },
      // Window keeps tracking a drag after the pointer leaves the contained
      // chat, and remains the only intent target so bubbling cannot deliver
      // the same gesture twice.
      intentTarget: window,
      scrollTarget
    });

    return () => {
      controller.dispose();
      unbindNativeScrollEvents();
    };
  }, [
    activeTab,
    allowAutoStickReleaseRef,
    canRevealEarlierHistory,
    chatThreadRef,
    getChatScrollMetrics,
    getFreshChatScrollMetrics,
    historyAutoLoadArmedRef,
    historyAutoLoadRearmBlockedUntilRef,
    liveChatSourceSessionId,
    loadEarlierHistoryFromMetrics,
    pendingHistoryExpansionRef,
    shouldStickToBottomRef,
    updateHistoryAutoLoadPending,
    updateShowScrollToLatest,
    usePageScrollForChat
  ]);
}
