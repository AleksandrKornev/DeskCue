import type { PendingChatPrompt } from "@models/promptDelivery";

export interface PromptStateCache {
  pendingChatPrompt?: PendingChatPrompt | null;
  awaitingChatReplySince?: string | null;
  isWaitingForChatReply?: boolean;
}
