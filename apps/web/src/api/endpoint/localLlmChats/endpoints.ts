import type {
  CreateLocalLlmChatInput,
  LocalLlmChatDetail,
  LocalLlmChatSummary,
  LocalLlmChatsResponse,
  PreviewNetworkMode,
  SendLocalLlmChatMessageInput,
  SaveLocalLlmPendingPromptInput,
  UpdateLocalLlmChatAgentModeInput,
  UpdateLocalLlmChatModelInput,
  UpdateLocalLlmChatWorkspaceInput
} from "@deskcue/protocol";
import { deleteJson, getJson, patchJson, postJson } from "@api/transport/requests";

const ROOT = "/api/local-llm/chats";

export const localLlmChatsApi = {
  async list() {
    const response = await getJson<LocalLlmChatsResponse>(ROOT, "Failed to load local chats");
    return response.chats;
  },

  create(input: CreateLocalLlmChatInput, options?: { signal?: AbortSignal }) {
    return postJson<LocalLlmChatSummary>(
      ROOT,
      input,
      "Failed to create local chat",
      options
    );
  },

  importLmStudioDesktop(input: { content: string; model: string; sourceFileName: string }) {
    return postJson<LocalLlmChatSummary>(
      `${ROOT}/import/lm-studio-desktop`,
      input,
      "Failed to import LM Studio Desktop chat"
    );
  },

  get(chatId: string, options: {
    changeSets?: string | null;
    events?: string | null;
    messages?: string | null;
    tail?: "history" | "initial" | "live";
  } = {}) {
    const query = new URLSearchParams();
    if (options.messages) query.set("messages", options.messages);
    if (options.events) query.set("events", options.events);
    if (options.changeSets) query.set("changeSets", options.changeSets);
    if (options.tail && options.tail !== "history") query.set("tail", options.tail);
    const suffix = query.size ? `?${query.toString()}` : "";
    return getJson<LocalLlmChatDetail>(
      `${ROOT}/${encodeURIComponent(chatId)}${suffix}`,
      "Failed to load local chat"
    );
  },

  getChangeSetDiff(chatId: string, changeSetId: string) {
    return getJson<{ changeSetId: string; diff: string }>(
      `${ROOT}/${encodeURIComponent(chatId)}/change-sets/${encodeURIComponent(changeSetId)}`,
      "Failed to load local change details"
    );
  },

  updateWorkspace(chatId: string, input: UpdateLocalLlmChatWorkspaceInput) {
    return patchJson<LocalLlmChatDetail>(
      `${ROOT}/${encodeURIComponent(chatId)}`,
      input,
      "Failed to update local chat workspace"
    );
  },

  updateAgentMode(chatId: string, input: UpdateLocalLlmChatAgentModeInput) {
    return patchJson<LocalLlmChatDetail>(
      `${ROOT}/${encodeURIComponent(chatId)}/agent-mode`,
      input,
      "Failed to update local agent mode"
    );
  },

  updateModel(chatId: string, input: UpdateLocalLlmChatModelInput) {
    return patchJson<LocalLlmChatDetail>(
      `${ROOT}/${encodeURIComponent(chatId)}/model`,
      input,
      "Failed to update local chat model"
    );
  },

  savePendingLmStudioPrompt(chatId: string, input: SaveLocalLlmPendingPromptInput) {
    return postJson<LocalLlmChatDetail>(
      `${ROOT}/${encodeURIComponent(chatId)}/pending-lm-studio-prompt`,
      input,
      "Failed to save the LM Studio message"
    );
  },

  discardPendingLmStudioPrompt(chatId: string) {
    return deleteJson<LocalLlmChatDetail>(
      `${ROOT}/${encodeURIComponent(chatId)}/pending-lm-studio-prompt`,
      "Failed to discard the saved LM Studio message"
    );
  },

  updatePreview(chatId: string, input: { port: number | null; networkMode: PreviewNetworkMode }) {
    return postJson<LocalLlmChatDetail>(
      `${ROOT}/${encodeURIComponent(chatId)}/preview`,
      input,
      "Failed to update local chat preview"
    );
  },

  refreshGit(chatId: string) {
    return postJson<LocalLlmChatDetail>(
      `${ROOT}/${encodeURIComponent(chatId)}/git/refresh`,
      {},
      "Failed to refresh workspace changes"
    );
  },

  resolveAction(chatId: string, actionRequestId: string, decision: "approve" | "reject") {
    return postJson<LocalLlmChatDetail>(
      `${ROOT}/${encodeURIComponent(chatId)}/actions/${encodeURIComponent(actionRequestId)}`,
      { decision },
      "Failed to resolve local agent action"
    );
  },

  send(chatId: string, input: SendLocalLlmChatMessageInput) {
    return postJson<LocalLlmChatDetail>(
      `${ROOT}/${encodeURIComponent(chatId)}/messages`,
      input,
      "Failed to send local chat message"
    );
  },

  interrupt(chatId: string) {
    return postJson<LocalLlmChatDetail>(
      `${ROOT}/${encodeURIComponent(chatId)}/interrupt`,
      {},
      "Failed to stop local generation"
    );
  }
};
