import { useEffect } from "react";

import {
  CHAT_AUTO_STICK_RELEASE_DELAY_MS,
  CHAT_AUTO_STICK_SETTLE_DELAYS_MS,
  isLiveOverviewChat
} from "./helpers";
import type {
  ChatAutoStickRefs,
  LiveChatAutoStickState
} from "./types";

export function useManagedSessionSettleAutoStick({
  activeTab,
  allowAutoStickReleaseRef,
  bottomStickKey,
  chatThreadRef,
  conversationTimelineLength,
  shouldSettleAfterContentChange,
  liveChatSourceSessionId,
  mobileChatViewportMetrics,
  syncBottomIfSticky,
  usePageScrollForChat,
  visibleTimelineLimit
}: Pick<LiveChatAutoStickState,
  | "activeTab"
  | "conversationTimelineLength"
  | "liveChatSourceSessionId"
  | "mobileChatViewportMetrics"
  | "usePageScrollForChat"
  | "visibleTimelineLimit"
> &
  Pick<ChatAutoStickRefs, "allowAutoStickReleaseRef" | "chatThreadRef"> & {
    bottomStickKey: string;
    shouldSettleAfterContentChange: boolean;
    syncBottomIfSticky: () => void;
  }) {
  useEffect(() => {
    if (
      !isLiveOverviewChat(activeTab, liveChatSourceSessionId) ||
      usePageScrollForChat ||
      !shouldSettleAfterContentChange
    ) {
      return;
    }

    const element = chatThreadRef.current;
    if (!element) {
      return;
    }

    const animationFrames: number[] = [];
    const timeouts = CHAT_AUTO_STICK_SETTLE_DELAYS_MS.map((delay) =>
      window.setTimeout(() => {
        animationFrames.push(window.requestAnimationFrame(syncBottomIfSticky));
      }, delay)
    );

    const unlockTimeoutId = window.setTimeout(() => {
      allowAutoStickReleaseRef.current = true;
    }, CHAT_AUTO_STICK_RELEASE_DELAY_MS);

    return () => {
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      animationFrames.forEach((animationFrameId) => window.cancelAnimationFrame(animationFrameId));
      window.clearTimeout(unlockTimeoutId);
    };
  }, [
    activeTab,
    allowAutoStickReleaseRef,
    bottomStickKey,
    chatThreadRef,
    conversationTimelineLength,
    liveChatSourceSessionId,
    mobileChatViewportMetrics.composerHeight,
    mobileChatViewportMetrics.toolbarHeight,
    shouldSettleAfterContentChange,
    syncBottomIfSticky,
    usePageScrollForChat,
    visibleTimelineLimit
  ]);
}
