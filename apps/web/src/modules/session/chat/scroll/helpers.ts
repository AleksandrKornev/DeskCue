import type {
  ChatHistoryAnchor,
  ChatScrollMetrics,
  MobileChatViewportMetrics
} from "@modules/session/chat/scroll/types";

import { SCROLL_TO_LATEST_THRESHOLD_PX } from "./constants";

export function shouldShowScrollToLatest(metrics: ChatScrollMetrics) {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight > SCROLL_TO_LATEST_THRESHOLD_PX;
}

export function readElementScrollMetrics(element: HTMLElement | null) {
  if (!element) {
    return null;
  }

  return {
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop
  };
}

export function readPageScrollMetrics() {
  if (typeof window === "undefined") {
    return null;
  }

  const scrollingElement = document.scrollingElement ?? document.documentElement;

  return {
    clientHeight: window.innerHeight,
    scrollHeight: scrollingElement.scrollHeight,
    scrollTop: scrollingElement.scrollTop
  };
}

export function areMobileChatViewportMetricsEqual(
  current: MobileChatViewportMetrics,
  next: MobileChatViewportMetrics
) {
  return (
    current.composerHeight === next.composerHeight &&
    current.stickyOffset === next.stickyOffset &&
    current.toolbarHeight === next.toolbarHeight
  );
}

export function captureChatHistoryAnchor({
  container,
  conversationMessageCount,
  metrics,
  usePageScrollForChat
}: {
  container: HTMLElement | null;
  conversationMessageCount: number;
  metrics: ChatScrollMetrics;
  usePageScrollForChat: boolean;
}): ChatHistoryAnchor {
  if (!container || usePageScrollForChat) {
    return {
      anchorMessageId: null,
      anchorTop: 0,
      previousConversationMessageCount: conversationMessageCount,
      previousScrollTop: metrics.scrollTop,
      previousScrollHeight: metrics.scrollHeight
    };
  }

  const containerRect = container.getBoundingClientRect();
  const firstVisibleMessage = Array.from(
    container.querySelectorAll<HTMLElement>("[data-chat-message-id]")
  ).find((messageElement) => messageElement.getBoundingClientRect().bottom > containerRect.top + 1);

  return {
    anchorMessageId: firstVisibleMessage?.dataset.chatMessageId ?? null,
    anchorTop: firstVisibleMessage
      ? firstVisibleMessage.getBoundingClientRect().top - containerRect.top
      : 0,
    previousConversationMessageCount: conversationMessageCount,
    previousScrollTop: metrics.scrollTop,
    previousScrollHeight: metrics.scrollHeight
  };
}

export function resolveAnchoredHistoryScrollTop({
  anchor,
  container,
  metrics,
  usePageScrollForChat
}: {
  anchor: ChatHistoryAnchor;
  container: HTMLElement | null;
  metrics: ChatScrollMetrics;
  usePageScrollForChat: boolean;
}) {
  const scrollHeightDelta = metrics.scrollHeight - anchor.previousScrollHeight;

  if (!anchor.anchorMessageId || !container || usePageScrollForChat) {
    return anchor.previousScrollTop + scrollHeightDelta;
  }

  const containerRect = container.getBoundingClientRect();
  const anchorElement = Array.from(
    container.querySelectorAll<HTMLElement>("[data-chat-message-id]")
  ).find((messageElement) => messageElement.dataset.chatMessageId === anchor.anchorMessageId);
  const nextAnchorTop = anchorElement
    ? anchorElement.getBoundingClientRect().top - containerRect.top
    : anchor.anchorTop;

  return metrics.scrollTop + nextAnchorTop - anchor.anchorTop;
}

export function updateCachedElementScrollTop(
  metrics: ChatScrollMetrics,
  nextScrollTop: number
) {
  metrics.scrollTop = Math.max(0, nextScrollTop);

  const minimumScrollHeight = metrics.scrollTop + metrics.clientHeight;
  if (minimumScrollHeight > metrics.scrollHeight) {
    metrics.scrollHeight = minimumScrollHeight;
  }
}
