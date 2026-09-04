import { describe, expect, it, vi } from "vitest";

import type { ChatScrollMetrics } from "@modules/session/chat/scroll/types";

import { createManagedSessionNativeScrollController } from "./managedSessionNativeScrollController";
import type { ManagedSessionNativeScrollScheduler } from "./managedSessionNativeScrollController";

class TestScheduler implements ManagedSessionNativeScrollScheduler {
  private nextHandle = 1;
  private readonly animationFrames = new Map<number, () => void>();
  private readonly timeouts = new Map<number, () => void>();

  cancelAnimationFrame = (handle: number) => {
    this.animationFrames.delete(handle);
  };

  clearTimeout = (handle: number) => {
    this.timeouts.delete(handle);
  };

  now = () => 100;

  requestAnimationFrame = (callback: () => void) => {
    const handle = this.nextHandle++;

    this.animationFrames.set(handle, callback);

    return handle;
  };

  setTimeout = (callback: () => void) => {
    const handle = this.nextHandle++;

    this.timeouts.set(handle, callback);

    return handle;
  };

  flushAnimationFrames() {
    const callbacks = [...this.animationFrames.values()];

    this.animationFrames.clear();

    callbacks.forEach((callback) => callback());
  }

  flushTimeouts() {
    const callbacks = [...this.timeouts.values()];

    this.timeouts.clear();

    callbacks.forEach((callback) => callback());
  }
}

function createFixture(scheduler: ManagedSessionNativeScrollScheduler) {
  const state = {
    allowAutoStickRelease: false,
    historyAutoLoadArmed: true,
    historyAutoLoadRearmBlockedUntil: 0,
    pendingHistoryExpansion: false,
    shouldStickToBottom: true
  };

  const metrics: ChatScrollMetrics = {
    clientHeight: 400,
    scrollHeight: 1_000,
    scrollTop: 0
  };

  const loadEarlierHistoryFromMetrics = vi.fn(() => true);
  const updateHistoryAutoLoadPending = vi.fn();
  const updateShowScrollToLatest = vi.fn();

  return {
    loadEarlierHistoryFromMetrics,
    metrics,
    options: {
      canRevealEarlierHistory: true,
      getAllowAutoStickRelease: () => state.allowAutoStickRelease,
      getChatScrollMetrics: () => metrics,
      getFreshChatScrollMetrics: () => metrics,
      getHistoryAutoLoadArmed: () => state.historyAutoLoadArmed,
      getHistoryAutoLoadRearmBlockedUntil: () =>
        state.historyAutoLoadRearmBlockedUntil,
      getPendingHistoryExpansion: () => state.pendingHistoryExpansion,
      getShouldStickToBottom: () => state.shouldStickToBottom,
      loadEarlierHistoryFromMetrics,
      scheduler,
      setAllowAutoStickRelease: (nextValue: boolean) => {
        state.allowAutoStickRelease = nextValue;
      },
      setHistoryAutoLoadArmed: (nextValue: boolean) => {
        state.historyAutoLoadArmed = nextValue;
      },
      setShouldStickToBottom: (nextValue: boolean) => {
        state.shouldStickToBottom = nextValue;
      },
      updateHistoryAutoLoadPending,
      updateShowScrollToLatest
    },
    state,
    updateHistoryAutoLoadPending,
    updateShowScrollToLatest
  };
}

describe("managed session native scroll controller lifecycle", () => {
  it("coalesces the immediate and animation-frame gesture paths into one history load", () => {
    const scheduler = new TestScheduler();
    const fixture = createFixture(scheduler);
    const controller = createManagedSessionNativeScrollController(fixture.options);

    controller.handlers.onWheel(-1);
    scheduler.flushAnimationFrames();
    scheduler.flushTimeouts();

    expect(fixture.loadEarlierHistoryFromMetrics).toHaveBeenCalledTimes(1);
    expect(fixture.updateHistoryAutoLoadPending).toHaveBeenLastCalledWith(false);
  });

  it("cancels pending work on dispose and ignores stale callbacks after remount", () => {
    const scheduler = new TestScheduler();
    const firstFixture = createFixture(scheduler);
    const firstController = createManagedSessionNativeScrollController(
      firstFixture.options
    );

    firstController.handlers.onWheel(-1);
    firstController.dispose();
    firstController.dispose();
    scheduler.flushAnimationFrames();
    scheduler.flushTimeouts();

    expect(firstFixture.loadEarlierHistoryFromMetrics).not.toHaveBeenCalled();
    expect(firstFixture.updateHistoryAutoLoadPending).toHaveBeenLastCalledWith(false);

    const secondFixture = createFixture(scheduler);
    const secondController = createManagedSessionNativeScrollController(
      secondFixture.options
    );

    secondController.handlers.onWheel(-1);
    scheduler.flushAnimationFrames();
    scheduler.flushTimeouts();

    expect(firstFixture.loadEarlierHistoryFromMetrics).not.toHaveBeenCalled();
    expect(secondFixture.loadEarlierHistoryFromMetrics).toHaveBeenCalledTimes(1);
  });

  it("does not react to native events after disposal even if an event target delivers one late", () => {
    const scheduler = new TestScheduler();
    const fixture = createFixture(scheduler);
    const controller = createManagedSessionNativeScrollController(fixture.options);

    controller.dispose();
    controller.handlers.onWheel(-1);
    controller.handlers.onScroll();
    scheduler.flushAnimationFrames();
    scheduler.flushTimeouts();

    expect(fixture.loadEarlierHistoryFromMetrics).not.toHaveBeenCalled();
    expect(fixture.updateShowScrollToLatest).not.toHaveBeenCalled();
  });

  it("does not treat hover movement after pointerup as a history gesture", () => {
    const scheduler = new TestScheduler();
    const fixture = createFixture(scheduler);
    const controller = createManagedSessionNativeScrollController(fixture.options);

    controller.handlers.onPointerDown(100);
    controller.handlers.onPointerEnd();
    controller.handlers.onPointerMove(140);
    scheduler.flushAnimationFrames();
    scheduler.flushTimeouts();

    expect(fixture.loadEarlierHistoryFromMetrics).not.toHaveBeenCalled();
  });

  it("releases bottom stick on the first upward wheel step below the button threshold", () => {
    const scheduler = new TestScheduler();
    const fixture = createFixture(scheduler);
    const controller = createManagedSessionNativeScrollController(fixture.options);

    fixture.metrics.scrollTop = 600;
    controller.handlers.onScroll();
    controller.handlers.onWheel(-40);
    fixture.metrics.scrollTop = 560;
    controller.handlers.onScroll();

    expect(fixture.state.shouldStickToBottom).toBe(false);
    expect(fixture.updateShowScrollToLatest).toHaveBeenLastCalledWith(false);
  });

  it("keeps a detached chat detached across duplicate native scroll notifications", () => {
    const scheduler = new TestScheduler();
    const fixture = createFixture(scheduler);
    const controller = createManagedSessionNativeScrollController(fixture.options);

    fixture.metrics.scrollTop = 600;
    controller.handlers.onScroll();
    controller.handlers.onWheel(-40);
    fixture.metrics.scrollTop = 560;
    controller.handlers.onScroll();
    controller.handlers.onScroll();

    expect(fixture.state.shouldStickToBottom).toBe(false);
  });

  it("reattaches after the user returns all the way to the bottom", () => {
    const scheduler = new TestScheduler();
    const fixture = createFixture(scheduler);
    const controller = createManagedSessionNativeScrollController(fixture.options);

    fixture.metrics.scrollTop = 600;
    controller.handlers.onScroll();
    controller.handlers.onWheel(-40);
    fixture.metrics.scrollTop = 560;
    controller.handlers.onScroll();
    fixture.metrics.scrollTop = 600;
    controller.handlers.onScroll();

    expect(fixture.state.shouldStickToBottom).toBe(true);
  });

  it("recognizes an upward scrollbar drag from its pointerdown and scroll events", () => {
    const scheduler = new TestScheduler();
    const fixture = createFixture(scheduler);
    const controller = createManagedSessionNativeScrollController(fixture.options);

    fixture.metrics.scrollTop = 600;
    controller.handlers.onScroll();
    controller.handlers.onPointerDown(300);
    fixture.metrics.scrollTop = 560;
    controller.handlers.onScroll();

    expect(fixture.state.shouldStickToBottom).toBe(false);
    expect(fixture.updateShowScrollToLatest).toHaveBeenLastCalledWith(false);
  });

  it.each([
    ["ArrowUp", false],
    ["Home", false],
    ["PageUp", false],
    [" ", true]
  ])("releases bottom stick before %s scroll navigation", (key, shiftKey) => {
    const scheduler = new TestScheduler();
    const fixture = createFixture(scheduler);
    const controller = createManagedSessionNativeScrollController(fixture.options);

    fixture.metrics.scrollTop = 600;
    controller.handlers.onScroll();
    controller.handlers.onKeyDown(key, shiftKey);
    fixture.metrics.scrollTop = 560;
    controller.handlers.onScroll();

    expect(fixture.state.shouldStickToBottom).toBe(false);
  });

  it("releases bottom stick on a short upward touch gesture", () => {
    const scheduler = new TestScheduler();
    const fixture = createFixture(scheduler);
    const controller = createManagedSessionNativeScrollController(fixture.options);

    fixture.metrics.scrollTop = 600;
    controller.handlers.onScroll();
    controller.handlers.onTouchStart(100);
    controller.handlers.onTouchMove(112);
    fixture.metrics.scrollTop = 588;
    controller.handlers.onScroll();

    expect(fixture.state.shouldStickToBottom).toBe(false);
  });
});
