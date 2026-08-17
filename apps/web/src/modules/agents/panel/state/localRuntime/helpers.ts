import type { AgentKind, LocalLlmChatSummary } from "@deskcue/protocol";

import { LOCAL_RUNTIME_TABS } from "./constants";

export function filterLocalRuntimeChats({
  chats,
  query,
  runtimeId,
  selectedSourceId
}: {
  chats: LocalLlmChatSummary[];
  query: string;
  runtimeId: LocalLlmChatSummary["runtimeId"] | null;
  selectedSourceId: AgentKind | "all";
}) {
  if (selectedSourceId !== "all") {
    return [];
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();
  return chats.filter((chat) => {
    if (runtimeId && chat.runtimeId !== runtimeId) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }

    return [
      chat.title,
      chat.model,
      chat.runtimeId === "lm-studio" ? "lm studio" : "ollama"
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
}

export function buildLocalRuntimeTabs(chats: LocalLlmChatSummary[]) {
  return LOCAL_RUNTIME_TABS.map((runtime) => ({
    ...runtime,
    sessionCount: chats.filter((chat) => chat.runtimeId === runtime.id).length
  }));
}
