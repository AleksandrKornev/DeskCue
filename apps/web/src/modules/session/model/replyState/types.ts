import type { PendingChatPrompt } from "@models/promptDelivery";

export type ReplyCompletionBridge = {
  key: string;
  prompt: PendingChatPrompt;
};
