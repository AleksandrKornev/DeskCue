export const LOCAL_LLM_CHAT_UPDATED_EVENT = "deskcue:local-llm-chat-updated";

export type LocalLlmChatUpdatedEventDetail = {
  chatId: string;
  terminal: boolean;
};
