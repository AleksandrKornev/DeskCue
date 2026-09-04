import type {
  AgentKind,
  AgentSessionSubagent,
  AgentSessionSummary
} from "@deskcue/protocol";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

function readOptionalDepth(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function readSpawnedSubagent(
  agentId: AgentKind,
  source: unknown
): AgentSessionSubagent | null {
  if (!isRecord(source)) return null;

  const subagent = source.subagent;

  if (!isRecord(subagent)) return null;

  const threadSpawn = subagent.thread_spawn;

  if (!isRecord(threadSpawn)) return null;

  const parentSourceSessionId = readOptionalString(threadSpawn.parent_thread_id);

  if (!parentSourceSessionId) return null;

  return {
    depth: readOptionalDepth(threadSpawn.depth),
    nickname: readOptionalString(threadSpawn.agent_nickname),
    parentSessionId: `${agentId}:${parentSourceSessionId}`,
    role: readOptionalString(threadSpawn.agent_role)
  };
}

export function isDirectSubagentOf(
  session: Pick<AgentSessionSummary, "subagent">,
  parentSessionId: string
) {
  return session.subagent?.parentSessionId === parentSessionId;
}

export function isTopLevelAgentSession(
  session: Pick<AgentSessionSummary, "subagent">
) {
  return !session.subagent;
}
