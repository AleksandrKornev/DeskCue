import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import type {
  AgentKind,
  LocalLlmChatSummary
} from "@deskcue/protocol";

import { buildLocalRuntimeTabs, filterLocalRuntimeChats } from "./helpers";

export function useLocalRuntimeChatSelection({
  chats,
  onSelectSource,
  query,
  selectedSourceId
}: {
  chats: LocalLlmChatSummary[];
  onSelectSource: (sourceId: AgentKind | "all") => void;
  query: string;
  selectedSourceId: AgentKind | "all";
}) {
  const [selectedChatId, setSelectedChatId] = useState("");
  const [selectedRuntime, setSelectedRuntime] =
    useState<LocalLlmChatSummary["runtimeId"] | null>(null);
  const queryMatchedChats = useMemo(
    () => filterLocalRuntimeChats({
      chats,
      query,
      runtimeId: null,
      selectedSourceId: "all"
    }),
    [chats, query]
  );
  const filteredChats = useMemo(
    () => filterLocalRuntimeChats({
      chats,
      query,
      runtimeId: selectedRuntime,
      selectedSourceId
    }),
    [chats, query, selectedRuntime, selectedSourceId]
  );
  const runtimeTabs = useMemo(
    () => buildLocalRuntimeTabs(query.trim() ? queryMatchedChats : chats),
    [chats, query, queryMatchedChats]
  );
  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? null,
    [chats, selectedChatId]
  );

  const selectRuntime = useCallback((runtimeId: LocalLlmChatSummary["runtimeId"]) => {
    setSelectedChatId("");
    setSelectedRuntime(runtimeId);
    if (selectedSourceId !== "all") {
      onSelectSource("all");
    }
  }, [onSelectSource, selectedSourceId]);

  const selectSource = useCallback((sourceId: AgentKind | "all") => {
    setSelectedRuntime(null);
    onSelectSource(sourceId);
  }, [onSelectSource]);
  const clearSelectedChat = useCallback(() => setSelectedChatId(""), []);
  const openChat = useCallback((chat: LocalLlmChatSummary) => {
    setSelectedChatId(chat.id);
  }, []);

  useEffect(() => {
    if (
      selectedRuntime &&
      query.trim() &&
      !queryMatchedChats.some((chat) => chat.runtimeId === selectedRuntime)
    ) {
      setSelectedRuntime(null);
    }
  }, [query, queryMatchedChats, selectedRuntime]);

  return {
    clearSelectedChat,
    filteredChats,
    openChat,
    queryMatchedChatsCount: queryMatchedChats.length,
    runtimeTabs,
    selectedChat,
    selectedRuntime,
    selectRuntime,
    selectSource
  };
}
