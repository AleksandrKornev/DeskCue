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
    onKeyDown: (key: string, shiftKey: boolean) => void;
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

export function isChatAtBottom(metrics: ChatScrollMetrics) {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= 1;
}

class ManagedSessionNativeScrollControllerImpl implements ManagedSessionNativeScrollController {
  private disposed = false;
  private pendingAutoLoadTimeout: number | null = null;
  private pendingIntentAnimationFrame: number | null = null;
  private lastScrollTop: number | null;
  private lastHistoryGateIntentAt = 0;
  private lastUserScrollIntentAt = 0;
  private touchStartClientY: number | null = null;
  private pointerStartClientY: number | null = null;

  readonly handlers = {
    onKeyDown: (key: string, shiftKey: boolean) => this.handleKeyDown(key, shiftKey),
    onPointerDown: (clientY: number) => this.handlePointerDown(clientY),
    onPointerEnd: () => this.handlePointerEnd(),
    onPointerMove: (clientY: number) => this.handlePointerMove(clientY),
    onScroll: () => this.handleNativeScroll(),
    onTouchEnd: () => this.handleTouchEnd(),
    onTouchMove: (clientY: number | undefined) => this.handleTouchMove(clientY),
    onTouchStart: (clientY: number | null) => this.handleTouchStart(clientY),
    onWheel: (deltaY: number) => this.handleWheel(deltaY)
  };

  constructor(private readonly options: ManagedSessionNativeScrollControllerOptions) {
    this.lastScrollTop = options.getChatScrollMetrics()?.scrollTop ?? null;
  }

  dispose() {
    if (this.disposed) return;

    this.disposed = true;
    this.clearPendingAutoLoad();
    this.clearPendingIntentAnimationFrame();
  }

  private clearPendingAutoLoad() {
    if (this.pendingAutoLoadTimeout === null) return;

    this.options.scheduler.clearTimeout(this.pendingAutoLoadTimeout);
    this.pendingAutoLoadTimeout = null;
    this.options.updateHistoryAutoLoadPending(false);
  }

  private clearPendingIntentAnimationFrame() {
    if (this.pendingIntentAnimationFrame === null) return;

    this.options.scheduler.cancelAnimationFrame(this.pendingIntentAnimationFrame);
    this.pendingIntentAnimationFrame = null;
  }

  private hasRecentUserScrollIntent() {
    return (
      hasRecentChatUserScrollIntent({
        lastIntentAt: this.lastUserScrollIntentAt,
        now: this.options.scheduler.now()
      })
    );
  }

  private syncStateFromMetrics(metrics: ChatScrollMetrics) {
    const nextShowScrollToLatest = shouldShowScrollToLatest(metrics);

    if (!nextShowScrollToLatest) {
      if (isChatAtBottom(metrics)) this.options.setShouldStickToBottom(true);

      this.options.updateShowScrollToLatest(false);
      return;
    }

    if (
      shouldKeepAutoStickForNativeScroll({
        allowAutoStickRelease: this.options.getAllowAutoStickRelease(),
        hasRecentUserScrollIntent: this.hasRecentUserScrollIntent(),
        isAwayFromBottom: nextShowScrollToLatest,
        shouldStickToBottom: this.options.getShouldStickToBottom()
      })
    ) {
      this.options.setShouldStickToBottom(true);
      this.options.updateShowScrollToLatest(false);
      return;
    }

    this.options.setShouldStickToBottom(!nextShowScrollToLatest);
    this.options.updateShowScrollToLatest(nextShowScrollToLatest);
  }

  private scheduleAutoLoadEarlier(scheduledMetrics: ChatScrollMetrics) {
    const scheduledScrollTop = scheduledMetrics.scrollTop;

    this.clearPendingAutoLoad();

    this.options.updateHistoryAutoLoadPending(true);

    this.pendingAutoLoadTimeout = this.options.scheduler.setTimeout(() => {
      this.pendingAutoLoadTimeout = null;
      if (this.disposed) return;

      const metrics = this.options.getFreshChatScrollMetrics();

      if (
        !metrics ||
        metrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX ||
        Math.abs(metrics.scrollTop - scheduledScrollTop) > 2 ||
        !this.options.getHistoryAutoLoadArmed() ||
        this.options.getPendingHistoryExpansion()
      ) {
        this.options.updateHistoryAutoLoadPending(false);
        return;
      }

      this.options.loadEarlierHistoryFromMetrics(metrics);
      this.options.updateHistoryAutoLoadPending(false);
    }, CHAT_HISTORY_AUTO_LOAD_IDLE_DELAY_MS);
  }

  private hasRecentHistoryGateIntent() {
    return this.options.scheduler.now() - this.lastHistoryGateIntentAt <=
      CHAT_HISTORY_AUTO_LOAD_INTENT_WINDOW_MS;
  }

  private rearmHistoryAutoLoadFromIntent(metrics: ChatScrollMetrics) {
    if (
      this.options.getHistoryAutoLoadArmed() ||
      this.options.getPendingHistoryExpansion() ||
      metrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX ||
      this.options.scheduler.now() < this.options.getHistoryAutoLoadRearmBlockedUntil() ||
      !this.hasRecentHistoryGateIntent()
    ) {
      return false;
    }

    this.options.setHistoryAutoLoadArmed(true);
    return true;
  }

  private scheduleHistoryAutoLoadFromIntent() {
    if (!this.options.canRevealEarlierHistory) {
      this.clearPendingAutoLoad();
      return;
    }

    const metrics = this.options.getFreshChatScrollMetrics();

    if (!metrics || metrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX) return;

    const blockedForMs =
      this.options.getHistoryAutoLoadRearmBlockedUntil() - this.options.scheduler.now();
    if (
      blockedForMs > 0 &&
      !this.options.getHistoryAutoLoadArmed() &&
      !this.options.getPendingHistoryExpansion()
    ) {
      this.clearPendingAutoLoad();
      this.options.updateHistoryAutoLoadPending(true);
      this.pendingAutoLoadTimeout = this.options.scheduler.setTimeout(() => {
        this.pendingAutoLoadTimeout = null;
        if (this.disposed) return;

        const nextMetrics = this.options.getFreshChatScrollMetrics();

        if (
          !nextMetrics ||
          nextMetrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX ||
          !this.hasRecentHistoryGateIntent() ||
          this.options.getPendingHistoryExpansion()
        ) {
          this.options.updateHistoryAutoLoadPending(false);
          return;
        }

        this.options.setHistoryAutoLoadArmed(true);
        this.scheduleAutoLoadEarlier(nextMetrics);
      }, blockedForMs);
      return;
    }

    this.rearmHistoryAutoLoadFromIntent(metrics);

    if (this.options.getHistoryAutoLoadArmed() && !this.options.getPendingHistoryExpansion()) {
      this.scheduleAutoLoadEarlier(metrics);
    }
  }

  private scheduleHistoryAutoLoadAfterNativeIntent() {
    this.clearPendingIntentAnimationFrame();
    this.pendingIntentAnimationFrame = this.options.scheduler.requestAnimationFrame(() => {
      this.pendingIntentAnimationFrame = null;
      if (!this.disposed) this.scheduleHistoryAutoLoadFromIntent();
    });
  }

  private markHistoryGateIntent() {
    this.lastHistoryGateIntentAt = this.options.scheduler.now();
  }

  private markUserScrollIntent() {
    this.lastUserScrollIntentAt = this.options.scheduler.now();
  }

  private releaseAutoStickForHistoryIntent() {
    this.options.setAllowAutoStickRelease(true);
    this.options.setShouldStickToBottom(false);

    const metrics =
      this.options.getFreshChatScrollMetrics() ?? this.options.getChatScrollMetrics();
    if (metrics) {
      this.options.updateShowScrollToLatest(shouldShowScrollToLatest(metrics));
    }
  }

  private handleNativeScroll() {
    if (this.disposed) return;

    const metrics =
      this.options.getFreshChatScrollMetrics() ?? this.options.getChatScrollMetrics();

    if (!metrics) return;

    const previousScrollTop = this.lastScrollTop;

    this.lastScrollTop = metrics.scrollTop;
    const isScrollingTowardHistoryGate =
      previousScrollTop !== null && metrics.scrollTop < previousScrollTop - 1;
    const isScrollingAwayFromHistoryGate =
      previousScrollTop !== null && metrics.scrollTop > previousScrollTop + 1;

    this.syncStateFromMetrics(metrics);

    if (
      shouldReleaseAutoStickForNativeScroll({
        hasRecentUserScrollIntent: this.hasRecentUserScrollIntent(),
        isScrollingTowardHistoryGate
      })
    ) {
      this.releaseAutoStickForHistoryIntent();
    }

    if (
      isScrollingTowardHistoryGate &&
      metrics.scrollTop <= CHAT_HISTORY_LOAD_THRESHOLD_PX * 2
    ) {
      this.markHistoryGateIntent();
    }

    if (
      metrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX * 2 &&
      isScrollingAwayFromHistoryGate &&
      this.options.scheduler.now() >= this.options.getHistoryAutoLoadRearmBlockedUntil()
    ) {
      this.options.setHistoryAutoLoadArmed(true);
      this.clearPendingAutoLoad();
    }

    if (metrics.scrollTop > CHAT_HISTORY_LOAD_THRESHOLD_PX) {
      this.clearPendingAutoLoad();
      return;
    }

    this.scheduleHistoryAutoLoadFromIntent();
  }

  private handleHistoryGesture() {
    this.markUserScrollIntent();
    this.releaseAutoStickForHistoryIntent();
    this.markHistoryGateIntent();
    this.scheduleHistoryAutoLoadFromIntent();
    this.scheduleHistoryAutoLoadAfterNativeIntent();
  }

  private handlePointerDown(clientY: number) {
    if (this.disposed) return;

    this.options.setAllowAutoStickRelease(true);
    this.markUserScrollIntent();
    this.pointerStartClientY = clientY;
  }

  private handleKeyDown(key: string, shiftKey: boolean) {
    if (this.disposed) return;

    const isHistoryNavigationKey =
      key === "ArrowUp" ||
      key === "Home" ||
      key === "PageUp" ||
      (key === " " && shiftKey);

    if (isHistoryNavigationKey) this.handleHistoryGesture();
  }

  private handlePointerMove(clientY: number) {
    if (this.disposed) return;

    if (
      this.pointerStartClientY === null ||
      clientY <= this.pointerStartClientY + 8
    ) {
      return;
    }

    this.handleHistoryGesture();
  }

  private handlePointerEnd() {
    this.pointerStartClientY = null;
  }

  private handleTouchStart(clientY: number | null) {
    if (this.disposed) return;

    this.options.setAllowAutoStickRelease(true);
    this.touchStartClientY = clientY;
  }

  private handleTouchMove(clientY: number | undefined) {
    if (this.disposed) return;

    if (
      this.touchStartClientY === null ||
      clientY === undefined ||
      clientY <= this.touchStartClientY + 8
    ) {
      return;
    }

    this.handleHistoryGesture();
  }

  private handleTouchEnd() {
    this.touchStartClientY = null;
  }

  private handleWheel(deltaY: number) {
    if (this.disposed) return;

    this.options.setAllowAutoStickRelease(true);
    if (deltaY >= 0) return;

    this.handleHistoryGesture();
  }
}

export function createManagedSessionNativeScrollController(
  options: ManagedSessionNativeScrollControllerOptions
): ManagedSessionNativeScrollController {
  return new ManagedSessionNativeScrollControllerImpl(options);
}
