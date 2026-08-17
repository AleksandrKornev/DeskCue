import type { ApiContractRoute } from "./apiContractTypes.ts";

export const localLlmPreviewApiContract: ApiContractRoute[] = [
  {
    method: "POST",
    path: "/api/local-llm/chats/:chatId/preview",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/local-llm/chats/:chatId/preview/artifacts",
    successStatuses: [201]
  }
];

export const localLlmApiContract: ApiContractRoute[] = [
  { method: "GET", path: "/api/local-llm/chats", successStatuses: [200] },
  { method: "POST", path: "/api/local-llm/chats", successStatuses: [201] },
  {
    method: "POST",
    path: "/api/local-llm/chats/import/lm-studio-desktop",
    successStatuses: [201]
  },
  { method: "GET", path: "/api/local-llm/chats/:chatId", successStatuses: [200] },
  {
    method: "GET",
    path: "/api/local-llm/chats/:chatId/change-sets/:changeSetId",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/local-llm/chats/:chatId/git/refresh",
    successStatuses: [200]
  },
  { method: "PATCH", path: "/api/local-llm/chats/:chatId", successStatuses: [200] },
  {
    method: "PATCH",
    path: "/api/local-llm/chats/:chatId/agent-mode",
    successStatuses: [200]
  },
  {
    method: "PATCH",
    path: "/api/local-llm/chats/:chatId/model",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/local-llm/chats/:chatId/pending-lm-studio-prompt",
    successStatuses: [200]
  },
  {
    method: "DELETE",
    path: "/api/local-llm/chats/:chatId/pending-lm-studio-prompt",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/local-llm/chats/:chatId/actions/:actionRequestId",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/local-llm/chats/:chatId/messages",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/local-llm/chats/:chatId/interrupt",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/runtimes/lm-studio/server/start",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/runtimes/ollama/server/start",
    successStatuses: [200]
  },
  { method: "GET", path: "/api/runtimes/lm-studio/models", successStatuses: [200] },
  { method: "GET", path: "/api/runtimes/ollama/models", successStatuses: [200] },
  { method: "POST", path: "/api/runtimes/lm-studio/prepare", successStatuses: [200] }
];
