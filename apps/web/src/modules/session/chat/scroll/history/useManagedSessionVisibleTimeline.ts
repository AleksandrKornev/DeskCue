import { useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  buildVisibleConversationTimeline,
  CHAT_HISTORY_PAGE_SIZE,
  countConversationMessages,
  MAX_VISIBLE_CHAT_MESSAGES,
  mergeRetainedConversationTimeline
} from "@modules/session/chat/timeline/timelineWindow";

import type { UseManagedSessionVisibleTimelineOptions } from "./types";

export function useManagedSessionVisibleTimeline({
  activeTab,
  conversationTimeline,
  liveChatSourceSessionId,
  resetKey
}: UseManagedSessionVisibleTimelineOptions) {
  const retainedConversationTimelineRef = useRef<typeof conversationTimeline>([]);
  const retainedConversationTimelineResetKeyRef = useRef(resetKey);
  const [timelineWindow, setTimelineWindow] = useState({
    firstLoadedMessageId: "",
    messageCount: 0,
    messageLimit: MAX_VISIBLE_CHAT_MESSAGES,
    resetKey
  });

  if (retainedConversationTimelineResetKeyRef.current !== resetKey) {
    retainedConversationTimelineResetKeyRef.current = resetKey;
    retainedConversationTimelineRef.current = [];
  }

  const timelineWithRetainedItems = useMemo(() => {
    if (!liveChatSourceSessionId || activeTab !== "overview") {
      return conversationTimeline;
    }

    const mergedTimeline = mergeRetainedConversationTimeline(
      retainedConversationTimelineRef.current,
      conversationTimeline
    );
    retainedConversationTimelineRef.current = mergedTimeline;

    return mergedTimeline;
  }, [activeTab, conversationTimeline, liveChatSourceSessionId]);

  const conversationMessageCount = useMemo(
    () => countConversationMessages(timelineWithRetainedItems),
    [timelineWithRetainedItems]
  );

  const firstLoadedMessageId = useMemo(
    () => timelineWithRetainedItems.find((item) => item.type === "message")?.entry.id ?? "",
    [timelineWithRetainedItems]
  );

  const visibleTimelineLimit = useMemo(() => {
    if (timelineWindow.resetKey !== resetKey) {
      return MAX_VISIBLE_CHAT_MESSAGES;
    }

    const appendedMessageCount =
      timelineWindow.firstLoadedMessageId === firstLoadedMessageId
        ? Math.max(0, conversationMessageCount - timelineWindow.messageCount)
        : 0;

    return timelineWindow.messageLimit + appendedMessageCount;
  }, [
    conversationMessageCount,
    firstLoadedMessageId,
    resetKey,
    timelineWindow
  ]);

  const { visibleItems: visibleConversationTimeline, hiddenCount: hiddenConversationItemCount } =
    useMemo(
      () => buildVisibleConversationTimeline(timelineWithRetainedItems, visibleTimelineLimit),
      [timelineWithRetainedItems, visibleTimelineLimit]
    );

  // Fifteen messages is the initial DOM window, not a sliding live tail. Keep
  // the first visible message anchored while the open chat receives new
  // prompts and replies; otherwise every append evicts a bubble from the top
  // and shifts the entire visible transcript. A session reset establishes a
  // fresh bounded window, and explicit history expansion still grows it in
  // controlled pages.
  useLayoutEffect(() => {
    setTimelineWindow((current) => {
      const next = {
        firstLoadedMessageId,
        messageCount: conversationMessageCount,
        messageLimit: visibleTimelineLimit,
        resetKey
      };

      return current.firstLoadedMessageId === next.firstLoadedMessageId &&
        current.messageCount === next.messageCount &&
        current.messageLimit === next.messageLimit &&
        current.resetKey === next.resetKey
        ? current
        : next;
    });
  }, [
    conversationMessageCount,
    firstLoadedMessageId,
    resetKey,
    visibleTimelineLimit
  ]);

  const expandVisibleTimelineLimit = (increment = CHAT_HISTORY_PAGE_SIZE) => {
    setTimelineWindow((current) => ({
      firstLoadedMessageId,
      messageCount: conversationMessageCount,
      messageLimit:
        (current.resetKey === resetKey ? visibleTimelineLimit : MAX_VISIBLE_CHAT_MESSAGES) + increment,
      resetKey
    }));
  };

  return {
    conversationMessageCount,
    expandVisibleTimelineLimit,
    firstLoadedMessageId,
    hiddenConversationItemCount,
    timelineWithRetainedItems,
    visibleConversationTimeline,
    visibleTimelineLimit
  };
}
