import type {
  AgentSessionSourceCount,
  AgentSessionSummary,
  LocalLlmChatSummary,
  RuntimeKind,
  RuntimeSummary,
  SessionSummary
} from "@deskcue/protocol";

export const CLI_STATUS_AGENT_SESSION_LIMIT = 2_000;
type CliStatusRuntimeId = RuntimeKind | "generic-cli";

export type CliStatusSnapshot = {
  activeChatCount: number;
  activeChatCountExact: boolean;
  chatCount: number;
  chatCountExact: boolean;
  generatedAt: string;
  lastChat: {
    id: string;
    model: string | null;
    sourceId: string;
    sourceLabel: string;
    title: string;
    updatedAt: string;
    workspaceName: string | null;
  } | null;
  runtimes: Array<{
    activeChatCount: number;
    activeChatCountExact: boolean;
    chatCount: number;
    chatCountExact: boolean;
    id: CliStatusRuntimeId;
    installed: boolean;
    label: string;
    lastActiveModel: string | null;
    loadedModelCount: number;
    modelCount: number;
    running: boolean;
    statusText: string;
  }>;
};

type ChatCandidate = NonNullable<CliStatusSnapshot["lastChat"]> & {
  active: boolean;
};

function compareChatCandidates(left: ChatCandidate, right: ChatCandidate) {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function isRootAgentSession(session: AgentSessionSummary) {
  return !session.subagent;
}

function isLocalChatActive(chat: LocalLlmChatSummary) {
  return chat.generationState === "running" || chat.generationState === "waiting_approval";
}

function toAgentCandidate(session: AgentSessionSummary): ChatCandidate {
  return {
    active: session.workState === "running",
    id: session.id,
    model: session.model,
    sourceId: session.agentId,
    sourceLabel: session.agentLabel,
    title: session.title,
    updatedAt: session.updatedAt,
    workspaceName: session.workspaceName
  };
}

function toLocalCandidate(chat: LocalLlmChatSummary, runtime: RuntimeSummary | undefined): ChatCandidate {
  return {
    active: isLocalChatActive(chat),
    id: chat.id,
    model: chat.model,
    sourceId: chat.runtimeId,
    sourceLabel: runtime?.label ?? chat.runtimeId,
    title: chat.title,
    updatedAt: chat.updatedAt,
    workspaceName: chat.workspace?.name ?? null
  };
}

function toGenericCliCandidate(session: SessionSummary): ChatCandidate {
  return {
    active: session.status === "running",
    id: session.id,
    model: null,
    sourceId: "generic-cli",
    sourceLabel: "Generic CLI",
    title: "Generic CLI session",
    updatedAt: session.lastActivityAt,
    workspaceName: session.workspaceName
  };
}

function toLastChat(candidate: ChatCandidate | undefined): CliStatusSnapshot["lastChat"] {
  if (!candidate) return null;

  const { active: _active, ...lastChat } = candidate;

  return lastChat;
}

export function buildCliStatusSnapshot({
  agentChatCount,
  agentChatCountExact,
  agentSessions,
  agentSourceCounts,
  localChats,
  managedSessions,
  runtimes,
  generatedAt = new Date().toISOString()
}: {
  agentChatCount: number;
  agentChatCountExact: boolean;
  agentSessions: AgentSessionSummary[];
  agentSourceCounts: AgentSessionSourceCount[];
  generatedAt?: string;
  localChats: LocalLlmChatSummary[];
  managedSessions: SessionSummary[];
  runtimes: RuntimeSummary[];
}): CliStatusSnapshot {
  const rootAgentSessions = agentSessions.filter(isRootAgentSession);
  const genericCliSessions = managedSessions.filter((session) => session.adapterId === "generic-cli");
  const sourceCountById = new Map(agentSourceCounts.map((count) => [count.agentId, count]));
  const runtimeById = new Map(runtimes.map((runtime) => [runtime.id, runtime]));
  const candidates = [
    ...rootAgentSessions.map(toAgentCandidate),
    ...localChats.map((chat) => toLocalCandidate(chat, runtimeById.get(chat.runtimeId))),
    ...genericCliSessions.map(toGenericCliCandidate)
  ].sort(compareChatCandidates);

  return {
    activeChatCount: candidates.filter((candidate) => candidate.active).length,
    activeChatCountExact: agentChatCountExact,
    chatCount: agentChatCount + localChats.length + genericCliSessions.length,
    chatCountExact: agentChatCountExact,
    generatedAt,
    lastChat: toLastChat(candidates[0]),
    runtimes: [...runtimes.map((runtime) => {
      const agentChats = rootAgentSessions.filter((session) => session.agentId === runtime.id);
      const localRuntimeChats = localChats.filter((chat) => chat.runtimeId === runtime.id);
      const sourceCount = sourceCountById.get(runtime.id as AgentSessionSummary["agentId"]);
      const agentRuntimeCount = sourceCount?.count ?? agentChats.length;
      const agentRuntimeCountExact = sourceCount?.exact ?? agentChatCountExact;

      return {
        activeChatCount: agentChats.filter((session) => session.workState === "running").length +
          localRuntimeChats.filter(isLocalChatActive).length,
        activeChatCountExact: agentRuntimeCountExact,
        chatCount: agentRuntimeCount + localRuntimeChats.length,
        chatCountExact: agentRuntimeCountExact,
        id: runtime.id,
        installed: runtime.installed,
        label: runtime.label,
        lastActiveModel: runtime.lastActiveModel,
        loadedModelCount: runtime.loadedModelCount,
        modelCount: runtime.modelCount,
        running: runtime.running,
        statusText: runtime.statusText
      };
    }), {
      activeChatCount: genericCliSessions.filter((session) => session.status === "running").length,
      activeChatCountExact: true,
      chatCount: genericCliSessions.length,
      chatCountExact: true,
      id: "generic-cli",
      installed: true,
      label: "Generic CLI",
      lastActiveModel: null,
      loadedModelCount: 0,
      modelCount: 0,
      running: genericCliSessions.some((session) => session.status === "running"),
      statusText: "available for local commands"
    }]
  };
}
