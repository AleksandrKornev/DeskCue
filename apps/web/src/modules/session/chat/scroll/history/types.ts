import type { RefObject } from "react";

import type {
  ChatScrollMetrics,
  ChatScrollOptions
} from "@modules/session/chat/scroll/types";

export type UseManagedSessionVisibleTimelineOptions = Pick<
  ChatScrollOptions,
  "activeTab" | "conversationTimeline" | "liveChatSourceSessionId" | "resetKey"
>;

export interface UseManagedSessionChatHistoryExpansionArgs {
  activeTab: string;
  canLoadMoreHistory: boolean;
  chatThreadRef: RefObject<HTMLDivElement | null>;
  conversationMessageCount: number;
  conversationTimelineLength: number;
  firstLoadedMessageId: string | null;
  hiddenConversationItemCount: number;
  isLoadingMoreHistory: boolean;
  liveChatSessionId: string | null;
  liveChatSourceSessionId: string | null;
  resetKey: string;
  usePageScrollForChat: boolean;
  visibleTimelineLimit: number;
  expandVisibleTimelineLimit: (increment?: number) => void;
  getFreshChatScrollMetrics: () => ChatScrollMetrics | null;
  onLoadMoreHistory: (beforeMessageId: string) => Promise<number> | number;
}
