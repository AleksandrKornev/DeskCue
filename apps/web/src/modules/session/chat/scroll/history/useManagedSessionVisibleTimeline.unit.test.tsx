import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ConversationTimelineItem } from "@modules/session/types";

import { useManagedSessionVisibleTimeline } from "./useManagedSessionVisibleTimeline";

function message(index: number): Extract<ConversationTimelineItem, { type: "message" }> {
  const id = `message-${index}`;

  return {
    activities: [],
    changeActivities: [],
    continued: false,
    entry: {
      id,
      phase: "complete",
      role: index % 2 === 0 ? "assistant" : "user",
      text: id,
      timestamp: new Date(Date.UTC(2026, 7, 6, 12, index)).toISOString()
    },
    key: id,
    role: index % 2 === 0 ? "assistant" : "user",
    timestamp: new Date(Date.UTC(2026, 7, 6, 12, index)).toISOString(),
    turnStatus: null,
    type: "message"
  };
}

function visibleMessageIds(items: ConversationTimelineItem[]) {
  return items.flatMap((item) => item.type === "message" ? [item.entry.id] : []);
}

describe("useManagedSessionVisibleTimeline", () => {
  it("keeps the initial live-window anchor when new source messages arrive", () => {
    const initialTimeline = Array.from({ length: 16 }, (_, index) => message(index));
    const { rerender, result } = renderHook(
      ({ conversationTimeline }) => useManagedSessionVisibleTimeline({
        activeTab: "overview",
        conversationTimeline,
        liveChatSourceSessionId: "source-session",
        resetKey: "managed-session"
      }),
      { initialProps: { conversationTimeline: initialTimeline } }
    );

    expect(visibleMessageIds(result.current.visibleConversationTimeline)).toEqual(
      Array.from({ length: 15 }, (_, index) => `message-${index + 1}`)
    );
    expect(result.current.hiddenConversationItemCount).toBe(1);

    rerender({ conversationTimeline: [...initialTimeline, message(16), message(17)] });

    expect(visibleMessageIds(result.current.visibleConversationTimeline)).toEqual(
      Array.from({ length: 17 }, (_, index) => `message-${index + 1}`)
    );
    expect(result.current.hiddenConversationItemCount).toBe(1);
  });

  it("starts with a fresh bounded window after the selected session changes", () => {
    const firstTimeline = Array.from({ length: 18 }, (_, index) => message(index));
    const secondTimeline = Array.from({ length: 20 }, (_, index) => message(index + 20));
    const { rerender, result } = renderHook(
      ({ conversationTimeline, resetKey }) => useManagedSessionVisibleTimeline({
        activeTab: "overview",
        conversationTimeline,
        liveChatSourceSessionId: "source-session",
        resetKey
      }),
      { initialProps: { conversationTimeline: firstTimeline, resetKey: "managed-session-a" } }
    );

    rerender({ conversationTimeline: secondTimeline, resetKey: "managed-session-b" });

    expect(visibleMessageIds(result.current.visibleConversationTimeline)).toEqual(
      Array.from({ length: 15 }, (_, index) => `message-${index + 25}`)
    );
    expect(result.current.hiddenConversationItemCount).toBe(5);
  });

  it("does not treat prepended history as live growth", () => {
    const initialTimeline = Array.from({ length: 16 }, (_, index) => message(index));
    const earlierTimeline = [message(-2), message(-1), ...initialTimeline];
    const { rerender, result } = renderHook(
      ({ conversationTimeline }) => useManagedSessionVisibleTimeline({
        activeTab: "overview",
        conversationTimeline,
        liveChatSourceSessionId: "source-session",
        resetKey: "managed-session"
      }),
      { initialProps: { conversationTimeline: initialTimeline } }
    );

    rerender({ conversationTimeline: earlierTimeline });

    expect(visibleMessageIds(result.current.visibleConversationTimeline)[0]).toBe("message-1");
    expect(result.current.hiddenConversationItemCount).toBe(3);

    act(() => result.current.expandVisibleTimelineLimit());

    expect(result.current.hiddenConversationItemCount).toBe(0);
  });
});
