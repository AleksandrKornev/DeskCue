import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  shouldShowScrollToLatestAfterResize,
  useManagedSessionResizeAutoStick
} from "./useManagedSessionResizeAutoStick";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("managed session resize auto-stick", () => {
  const metrics = {
    clientHeight: 400,
    scrollHeight: 1_000,
    scrollTop: 560
  };

  it("does not reattach a user-detached chat below the button threshold", () => {
    expect(shouldShowScrollToLatestAfterResize(metrics, false)).toBe(false);
  });

  it("shows the return control after detached content grows beyond the threshold", () => {
    expect(shouldShowScrollToLatestAfterResize({ ...metrics, scrollHeight: 1_200 }, false)).toBe(true);
  });

  it("keeps the return control hidden while the chat is following", () => {
    expect(shouldShowScrollToLatestAfterResize({ ...metrics, scrollHeight: 1_200 }, true)).toBe(false);
  });

  it("does not reattach or scroll after a detached transcript mutation", () => {
    let triggerMutation: (...args: unknown[]) => void = () => undefined;
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const shouldStickToBottomRef = { current: false };
    const syncBottomIfSticky = vi.fn();
    const updateShowScrollToLatest = vi.fn();
    const element = document.createElement("div");

    vi.stubGlobal("ResizeObserver", class {
      disconnect() {}
      observe() {}
      unobserve() {}
    });
    vi.stubGlobal("MutationObserver", class {
      constructor(callback: (...args: unknown[]) => void) {
        triggerMutation = callback;
      }

      disconnect() {}
      observe() {}
      takeRecords() { return []; }
    });

    renderHook(() => useManagedSessionResizeAutoStick({
      activeTab: "overview",
      bottomStickKey: "session-1",
      chatThreadRef: { current: element },
      conversationTimelineLength: 5,
      getFreshChatScrollMetrics: () => metrics,
      liveChatSourceSessionId: "codex:session-1",
      shouldStickToBottomRef,
      syncBottomIfSticky,
      updateShowScrollToLatest,
      usePageScrollForChat: false,
      visibleTimelineLimit: 100
    }));

    act(() => triggerMutation([], {}));

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(syncBottomIfSticky).not.toHaveBeenCalled();
    expect(shouldStickToBottomRef.current).toBe(false);
    expect(updateShowScrollToLatest).toHaveBeenLastCalledWith(false);
  });
});
