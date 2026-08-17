import {
  useCallback,
  useEffect,
  useRef
} from "react";
import type { RefObject } from "react";

import {
  CHAT_SCROLL_BOTTOM_SENTINEL,
  CHAT_SCROLL_METRIC_REFRESH_IDLE_DELAY_MS
} from "@modules/session/chat/scroll/constants";
import {
  readElementScrollMetrics,
  readPageScrollMetrics,
  updateCachedElementScrollTop
} from "@modules/session/chat/scroll/helpers";
import type { ChatScrollMetrics } from "@modules/session/chat/scroll/types";

export function useManagedSessionChatScrollTarget({
  chatThreadRef,
  usePageScrollForChat
}: {
  chatThreadRef: RefObject<HTMLDivElement | null>;
  usePageScrollForChat: boolean;
}) {
  const cachedElementMetricsRef = useRef<ChatScrollMetrics | null>(null);

  const getFreshChatScrollMetrics = useCallback(() => {
    if (usePageScrollForChat) {
      return readPageScrollMetrics();
    }

    const metrics = readElementScrollMetrics(chatThreadRef.current);
    cachedElementMetricsRef.current = metrics;
    return metrics;
  }, [chatThreadRef, usePageScrollForChat]);

  const getChatScrollMetrics = useCallback(() => {
    if (usePageScrollForChat) {
      return readPageScrollMetrics();
    }

    const element = chatThreadRef.current;
    if (!element) {
      return null;
    }

    const cachedMetrics = cachedElementMetricsRef.current;
    if (!cachedMetrics) {
      return null;
    }

    return {
      clientHeight: cachedMetrics.clientHeight,
      scrollHeight: cachedMetrics.scrollHeight,
      scrollTop: cachedMetrics.scrollTop
    };
  }, [chatThreadRef, usePageScrollForChat]);

  const setChatScrollTop = useCallback((nextScrollTop: number) => {
    if (usePageScrollForChat) {
      window.scrollTo({ top: nextScrollTop });
      return;
    }

    const element = chatThreadRef.current;
    if (element) {
      const cachedMetrics = cachedElementMetricsRef.current;
      const actualClientHeight = element.clientHeight;
      const actualScrollHeight = element.scrollHeight;
      const resolvedScrollTop =
        nextScrollTop === CHAT_SCROLL_BOTTOM_SENTINEL
          ? Math.max(0, actualScrollHeight - actualClientHeight)
          : nextScrollTop;

      element.scrollTop = resolvedScrollTop;

      if (cachedMetrics) {
        updateCachedElementScrollTop(cachedMetrics, resolvedScrollTop);
        cachedMetrics.clientHeight = actualClientHeight;
        cachedMetrics.scrollHeight = Math.max(cachedMetrics.scrollHeight, actualScrollHeight);
      }
    }
  }, [chatThreadRef, usePageScrollForChat]);

  useEffect(() => {
    if (
      usePageScrollForChat ||
      !chatThreadRef.current
    ) {
      return;
    }

    const element = chatThreadRef.current;
    let animationFrameId: number | null = null;
    let refreshTimeoutId: number | null = null;
    let lastScrollAt = 0;

    const refreshCachedMetrics = () => {
      animationFrameId = null;
      refreshTimeoutId = null;
      const metrics = readElementScrollMetrics(element);
      cachedElementMetricsRef.current = metrics;
    };

    const scheduleRefreshCachedMetrics = () => {
      if (animationFrameId !== null || refreshTimeoutId !== null) {
        return;
      }

      const elapsedSinceScroll = performance.now() - lastScrollAt;
      if (elapsedSinceScroll < CHAT_SCROLL_METRIC_REFRESH_IDLE_DELAY_MS) {
        refreshTimeoutId = window.setTimeout(
          () => {
            refreshTimeoutId = null;
            scheduleRefreshCachedMetrics();
          },
          CHAT_SCROLL_METRIC_REFRESH_IDLE_DELAY_MS - elapsedSinceScroll
        );
        return;
      }

      animationFrameId = window.requestAnimationFrame(refreshCachedMetrics);
    };

    const handleScroll = () => {
      lastScrollAt = performance.now();

      const cachedMetrics = cachedElementMetricsRef.current;
      if (cachedMetrics) {
        updateCachedElementScrollTop(cachedMetrics, element.scrollTop);
      }
    };

    scheduleRefreshCachedMetrics();
    element.addEventListener("scroll", handleScroll, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleRefreshCachedMetrics);
    resizeObserver?.observe(element);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      if (refreshTimeoutId !== null) {
        window.clearTimeout(refreshTimeoutId);
      }

      element.removeEventListener("scroll", handleScroll);
      resizeObserver?.disconnect();
    };
  }, [chatThreadRef, usePageScrollForChat]);

  const scrollChatToBottom = useCallback(() => {
    setChatScrollTop(CHAT_SCROLL_BOTTOM_SENTINEL);
  }, [setChatScrollTop]);

  return {
    getFreshChatScrollMetrics,
    getChatScrollMetrics,
    scrollChatToBottom,
    setChatScrollTop
  };
}
