import type { PendingChatPrompt } from "@models/promptDelivery";
import type { ConversationTimelineItem } from "@modules/session/types";

export interface ChatScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

export type MobileChatViewportMetrics = {
  composerHeight: number;
  stickyOffset: number;
  toolbarHeight: number;
};

export interface ChatHistoryAnchor {
  anchorMessageId: string | null;
  anchorTop: number;
  previousConversationMessageCount: number;
  previousScrollTop: number;
  previousScrollHeight: number;
}

export type ChatScrollOptions = {
  activeTab: string;
  bottomStickKey: string;
  canLoadMoreHistory: boolean;
  conversationTimeline: ConversationTimelineItem[];
  effectiveIsWaitingForChatReply: boolean;
  effectivePendingChatPrompt: PendingChatPrompt | null;
  isLoadingMoreHistory: boolean;
  isTakenOverChat: boolean;
  liveChatSessionId: string;
  liveChatSourceSessionId: string;
  onLoadMoreHistory: (beforeEntryId: string) => Promise<number>;
  resetKey: string;
};
