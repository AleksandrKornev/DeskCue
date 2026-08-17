import type { LocalLlmChatSummary } from "@deskcue/protocol";

export type LocalLlmChatSummariesState = {
  chats: LocalLlmChatSummary[];
  error: string | null;
};
