import { useMemo } from "react";

import type {
  LocalLlmChatSummary,
  SessionSummary
} from "@deskcue/protocol";

import {
  buildAgentSessionsUnifiedListModel,
  selectAttachedSourceSessionKeys
} from "./helpers";
import type { AgentSessionsUnifiedListModelOptions } from "./helpers";

export function useAgentSessionsUnifiedListModel({
  filteredLocalChats,
  localChats,
  queryMatchedLocalChatsCount,
  managedSessions,
  ...options
}: Omit<
  AgentSessionsUnifiedListModelOptions,
  "filteredLocalChatsCount" | "localChatsCount"
> & {
  filteredLocalChats: LocalLlmChatSummary[];
  localChats: LocalLlmChatSummary[];
  managedSessions: SessionSummary[];
}) {
  const attachedSourceSessionKeys = useMemo(
    () => selectAttachedSourceSessionKeys(managedSessions),
    [managedSessions]
  );
  const list = buildAgentSessionsUnifiedListModel({
    ...options,
    filteredLocalChatsCount: filteredLocalChats.length,
    localChatsCount: localChats.length,
    queryMatchedLocalChatsCount
  });

  return {
    ...list,
    attachedSourceSessionKeys
  };
}
