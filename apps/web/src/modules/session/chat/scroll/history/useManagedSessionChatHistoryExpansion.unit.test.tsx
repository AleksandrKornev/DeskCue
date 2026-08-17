import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatScrollMetrics } from "@modules/session/chat/scroll/types";

import { useManagedSessionChatHistoryExpansion } from "./useManagedSessionChatHistoryExpansion";

describe("useManagedSessionChatHistoryExpansion", () => {
  it("clears the previous chat anchor before laying out a new reset key", async () => {
    const container = document.createElement("div");
    container.scrollTop = 25;
    const chatThreadRef = { current: container };
    let metrics: ChatScrollMetrics = {
      clientHeight: 300,
      scrollHeight: 1_000,
      scrollTop: 25
    };
    let resolveHistory!: (count: number) => void;
    const historyResponse = new Promise<number>((resolve) => {
      resolveHistory = resolve;
    });
    const onLoadMoreHistory = vi.fn(() => historyResponse);
    const stableProps = {
      activeTab: "overview",
      canLoadMoreHistory: true,
      chatThreadRef,
      conversationMessageCount: 2,
      conversationTimelineLength: 2,
      expandVisibleTimelineLimit: vi.fn(),
      firstLoadedMessageId: "message-1",
      getFreshChatScrollMetrics: () => metrics,
      hiddenConversationItemCount: 0,
      isLoadingMoreHistory: false,
      liveChatSessionId: "session-1",
      liveChatSourceSessionId: "source-1",
      onLoadMoreHistory,
      usePageScrollForChat: false,
      visibleTimelineLimit: 2
    };
    const { rerender, result } = renderHook(
      ({ resetKey }) => useManagedSessionChatHistoryExpansion({
        ...stableProps,
        resetKey
      }),
      { initialProps: { resetKey: "chat-a" } }
    );

    act(() => {
      expect(result.current.loadEarlierHistoryFromMetrics(metrics)).toBe(true);
    });
    expect(onLoadMoreHistory).toHaveBeenCalledTimes(1);

    metrics = { ...metrics, scrollHeight: 1_500 };
    rerender({ resetKey: "chat-b" });

    expect(container.scrollTop).toBe(25);
    expect(result.current.pendingHistoryExpansionRef.current).toBeNull();

    await act(async () => {
      resolveHistory(1);
      await historyResponse;
    });
    expect(stableProps.expandVisibleTimelineLimit).not.toHaveBeenCalled();
  });
});
