import type { AgentSessionsListProps, AgentSessionWorkIndicator } from "@modules/agents/types";

export type AgentSessionListStatusIndicator = AgentSessionWorkIndicator | {
  label: "New result";
  tone: "review";
  viewerCount: 0;
  sessionId: string;
} | {
  label: "Attached";
  tone: "attached";
  viewerCount: 0;
  sessionId: string;
};

export type ChatListItem =
  | { kind: "agent"; updatedAt: string; session: AgentSessionsListProps["sessions"][number] }
  | { kind: "local"; updatedAt: string; chat: AgentSessionsListProps["localLlmChats"][number] };
