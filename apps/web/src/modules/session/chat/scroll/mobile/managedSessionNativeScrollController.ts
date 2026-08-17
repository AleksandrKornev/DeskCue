import {
  CHAT_HISTORY_AUTO_LOAD_IDLE_DELAY_MS,
  CHAT_HISTORY_AUTO_LOAD_INTENT_WINDOW_MS,
  CHAT_HISTORY_LOAD_THRESHOLD_PX
} from "@modules/session/chat/scroll/constants";
import { shouldShowScrollToLatest } from "@modules/session/chat/scroll/helpers";
import type { ChatScrollMetrics } from "@modules/session/chat/scroll/types";

export const CHAT_USER_SCROLL_INTENT_WINDOW_MS = 1_000;

export type ManagedSessionNativeScrollScheduler = {
  cancelAnimationFrame: (handle: number) => void;
  clearTimeout: (handle: number) => void;
  now: () => number;
  requestAnimationFrame: (callback: () => void) => number;
  setTimeout: (callback: () => void, delayMs: number) => number;
};

export type ManagedSessionNativeScrollController = {
  dispose: () => void;
  handlers: {
    onPointerDown: (clientY: number) => void;
    onPointerEnd: () => void;
    onPointerMove: (clientY: number) => void;
    onScroll: () => void;
    onTouchEnd: () => void;
    onTouchMove: (clientY: number | undefined) => void;
    onTouchStart: (clientY: number | null) => void;
    onWheel: (deltaY: number) => void;
  };
};

type ManagedSessionNativeScrollControllerOptions = {
  canRevealEarlierHistory: boolean;
  getAllowAutoStickRelease: () => boolean;
  getChatScrollMetrics: () => ChatScrollMetrics | null;
  getFreshChatScrollMetrics: () => ChatScrollMetrics | null;
  getHistoryAutoLoadArmed: () => boolean;
  getHistoryAutoLoadRearmBlockedUntil: () => number;
  getPendingHistoryExpansion: () => boolean;
  getShouldStickToBottom: () => boolean;
  loadEarlierHistoryFromMetrics: (metrics: ChatScrollMetrics) => boolean;
  scheduler: ManagedSessionNativeScrollScheduler;
  setAllowAutoStickRelease: (nextValue: boolean) => void;
  setHistoryAutoLoadArmed: (nextValue: boolean) => void;
  setShouldStickToBottom: (nextValue: boolean) => void;
  updateHistoryAutoLoadPending: (nextValue: boolean) => void;
  updateShowScrollToLatest: (nextValue: boolean) => void;
};

export function hasRecentChatUserScrollIntent({
  lastIntentAt,
  now
}: {
  lastIntentAt: number;
  now: number;
}) {
  return lastIntentAt > 0 && now - lastIntentAt <= CHAT_USER_SCROLL_INTENT_WINDOW_MS;
}

export function shouldKeepAutoStickForNativeScroll({
  allowAutoStickRelease,
  hasRecentUserScrollIntent,
  isAwayFromBottom,
  shouldStickToBottom
}: {
  allowAutoStickRelease: boolean;
  hasRecentUserScrollIntent: boolean;
  isAwayFromBottom: boolean;
  shouldStickToBottom: boolean;
}) {
  return (
    isAwayFromBottom &&
    (!allowAutoStickRelease ||
      (shouldStickToBottom && !hasRecentUserScrollIntent))
  );
}

export function shouldReleaseAutoStickForNativeScroll({
  hasRecentUserScrollIntent,
  isScrollingTowardHistoryGate
}: {
  hasRecentUserScrollIntent: boolean;
  isScrollingTowardHistoryGate: boolean;
}) {
  return isScrollingTowardHistoryGate && hasRecentUserScrollIntent;
}

export function createManagedSessionNativeScrollController(
  options: ManagedSessionNativeScrollControllerOptions
): ManagedSessionNativeScrollController {
  const { scheduler } = options;
  let disposed = false;
  let pendingAutoLoadTimeout: number | null = null;
  let pendingIntentAnimationFrame: number | null = null;
  let lastScrollTop = options.getChatScrollMetrics()?.scrollTop ?? null;
  let lastHistoryGateIntentAt = 0;
  let lastUserScrollIntentAt = 0;
  let touchStartClientY: number | null = null;
  let pointerStartClientY: number | null = null;

  const clearPendingAutoLoad = () => {
    if (pendingAutoLoadTimeout === null) {
      return;
    }

    scheduler.clearTimeout(pendingAutoLoadTimeout);
    pendingAutoLoadTimeout = null;
    options.updateHistoryAutoLoadPending(false);
  };

  const clearPendingIntentAnimationFrame = () => {
    if (pendingIntentAnimationFrame === null) {
      return;
    }

    scheduler.cancelAnimationFrame(pendingIntentAnimationFrame);
    pendingIntentAnimationFrame = null;
  };

  const hasRecentUserScrollIntent = () =>
    hasRecentChatUserScrollIntent({
      lastIntentAt: lastUserScrollIntentAt,
      now: scheduler.now()
    });

  const syncStateFromMetrics = (metrics: ChatScrollMetrics) => {
    const nextShowScrollToLatest = shouldShowScrollToLatest(metrics);

    if (!nextShowScrollToLatest) {
      options.setShouldStickToBottom(true);
      options.updateShowScrollToLatest(false);
      return;
    }

    if (
      shouldKeepAutoStickForNativeScroll({
        allowAutoStickRelease: options.getAllowAutoStickRelease(),
        hasRecentUserScrollIntent: hasRecentUserScrollIntent(),
        isAwayFromBottom: nextShowScrollToLatest,
        shouldStickToBottom: options.getShouldStickToBottom()
      })
    ) {
      options.setShouldStickToBottom(true);
      options.updateShowScrollToLatest(false);
      return;
    }

    options.setShouldStickToBottom(!nextShowScrollToLatest);
    options.updateShowScrollToLatest(nextShowScrollToLatest);
  };

  const scheduleAutoLoadEarlier = (scheduledMetrics: ChatScrollMetrics) => {
    const scheduledScrollTop = scheduledMetrics.scrollTop;
    clearPendingAutoLoad();
    options.updateHistoryAutoLoadPending(true);

    pendingAutoLoadTimeout = scheduler.setTimeout(() => {
      pendingAutoLoadTimeout = null;
      if (disposed) {
        return;
      }

      const metrics = options.getFreshChatScrollMetrics();
      if (
        !metrics ||
        metrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX ||
        Math.abs(metrics.scrollTop - scheduledScrollTop) > 2 ||
        !options.getHistoryAutoLoadArmed() ||
        options.getPendingHistoryExpansion()
      ) {
        options.updateHistoryAutoLoadPending(false);
        return;
      }

      options.loadEarlierHistoryFromMetrics(metrics);
      options.updateHistoryAutoLoadPending(false);
    }, CHAT_HISTORY_AUTO_LOAD_IDLE_DELAY_MS);
  };

  const hasRecentHistoryGateIntent = () =>
    scheduler.now() - lastHistoryGateIntentAt <=
    CHAT_HISTORY_AUTO_LOAD_INTENT_WINDOW_MS;

  const rearmHistoryAutoLoadFromIntent = (metrics: ChatScrollMetrics) => {
    if (
      options.getHistoryAutoLoadArmed() ||
      options.getPendingHistoryExpansion() ||
      metrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX ||
      scheduler.now() < options.getHistoryAutoLoadRearmBlockedUntil() ||
      !hasRecentHistoryGateIntent()
    ) {
      return false;
    }

    options.setHistoryAutoLoadArmed(true);
    return true;
  };

  const scheduleHistoryAutoLoadFromIntent = () => {
    if (!options.canRevealEarlierHistory) {
      clearPendingAutoLoad();
      return;
    }

    const metrics = options.getFreshChatScrollMetrics();
    if (!metrics || metrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX) {
      return;
    }

    const blockedForMs =
      options.getHistoryAutoLoadRearmBlockedUntil() - scheduler.now();
    if (
      blockedForMs > 0 &&
      !options.getHistoryAutoLoadArmed() &&
      !options.getPendingHistoryExpansion()
    ) {
      clearPendingAutoLoad();
      options.updateHistoryAutoLoadPending(true);
      pendingAutoLoadTimeout = scheduler.setTimeout(() => {
        pendingAutoLoadTimeout = null;
        if (disposed) {
          return;
        }

        const nextMetrics = options.getFreshChatScrollMetrics();
        if (
          !nextMetrics ||
          nextMetrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX ||
          !hasRecentHistoryGateIntent() ||
          options.getPendingHistoryExpansion()
        ) {
          options.updateHistoryAutoLoadPending(false);
          return;
        }

        options.setHistoryAutoLoadArmed(true);
        scheduleAutoLoadEarlier(nextMetrics);
      }, blockedForMs);
      return;
    }

    rearmHistoryAutoLoadFromIntent(metrics);

    if (options.getHistoryAutoLoadArmed() && !options.getPendingHistoryExpansion()) {
      scheduleAutoLoadEarlier(metrics);
    }
  };

  const scheduleHistoryAutoLoadAfterNativeIntent = () => {
    clearPendingIntentAnimationFrame();
    pendingIntentAnimationFrame = scheduler.requestAnimationFrame(() => {
      pendingIntentAnimationFrame = null;
      if (!disposed) {
        scheduleHistoryAutoLoadFromIntent();
      }
    });
  };

  const markHistoryGateIntent = () => {
    lastHistoryGateIntentAt = scheduler.now();
  };

  const markUserScrollIntent = () => {
    lastUserScrollIntentAt = scheduler.now();
  };

  const releaseAutoStickForHistoryIntent = () => {
    options.setAllowAutoStickRelease(true);
    options.setShouldStickToBottom(false);

    const metrics =
      options.getFreshChatScrollMetrics() ?? options.getChatScrollMetrics();
    if (metrics) {
      options.updateShowScrollToLatest(shouldShowScrollToLatest(metrics));
    }
  };

  const handleNativeScroll = () => {
    if (disposed) {
      return;
    }

    const metrics =
      options.getFreshChatScrollMetrics() ?? options.getChatScrollMetrics();
    if (!metrics) {
      return;
    }
    const previousScrollTop = lastScrollTop;
    lastScrollTop = metrics.scrollTop;
    const isScrollingTowardHistoryGate =
      previousScrollTop !== null && metrics.scrollTop < previousScrollTop - 1;
    const isScrollingAwayFromHistoryGate =
      previousScrollTop !== null && metrics.scrollTop > previousScrollTop + 1;

    if (
      shouldReleaseAutoStickForNativeScroll({
        hasRecentUserScrollIntent: hasRecentUserScrollIntent(),
        isScrollingTowardHistoryGate
      })
    ) {
      releaseAutoStickForHistoryIntent();
    }

    syncStateFromMetrics(metrics);

    if (
      isScrollingTowardHistoryGate &&
      metrics.scrollTop <= CHAT_HISTORY_LOAD_THRESHOLD_PX * 2
    ) {
      markHistoryGateIntent();
    }

    if (
      metrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX * 2 &&
      isScrollingAwayFromHistoryGate &&
      scheduler.now() >= options.getHistoryAutoLoadRearmBlockedUntil()
    ) {
      options.setHistoryAutoLoadArmed(true);
      clearPendingAutoLoad();
    }

    if (metrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX) {
      clearPendingAutoLoad();
      return;
    }

    scheduleHistoryAutoLoadFromIntent();
  };

  const handleHistoryGesture = () => {
    markUserScrollIntent();
    releaseAutoStickForHistoryIntent();
    markHistoryGateIntent();
    scheduleHistoryAutoLoadFromIntent();
    scheduleHistoryAutoLoadAfterNativeIntent();
  };

  const handlePointerDown = (clientY: number) => {
    if (disposed) {
      return;
    }
    options.setAllowAutoStickRelease(true);
    pointerStartClientY = clientY;
  };

  const handlePointerMove = (clientY: number) => {
    if (disposed) {
      return;
    }
    if (
      pointerStartClientY === null ||
      clientY <= pointerStartClientY + 8
    ) {
      return;
    }

    handleHistoryGesture();
  };

  const handlePointerEnd = () => {
    pointerStartClientY = null;
  };

  const handleTouchStart = (clientY: number | null) => {
    if (disposed) {
      return;
    }
    options.setAllowAutoStickRelease(true);
    touchStartClientY = clientY;
  };

  const handleTouchMove = (clientY: number | undefined) => {
    if (disposed) {
      return;
    }
    if (
      touchStartClientY === null ||
      clientY === undefined ||
      clientY <= touchStartClientY + 8
    ) {
      return;
    }

    handleHistoryGesture();
  };

  const handleTouchEnd = () => {
    touchStartClientY = null;
  };

  const handleWheel = (deltaY: number) => {
    if (disposed) {
      return;
    }
    options.setAllowAutoStickRelease(true);
    if (deltaY >= 0) {
      return;
    }

    handleHistoryGesture();
  };

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      clearPendingAutoLoad();
      clearPendingIntentAnimationFrame();
    },
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerEnd: handlePointerEnd,
      onPointerMove: handlePointerMove,
      onScroll: handleNativeScroll,
      onTouchEnd: handleTouchEnd,
      onTouchMove: handleTouchMove,
      onTouchStart: handleTouchStart,
      onWheel: handleWheel
    }
  };
}
