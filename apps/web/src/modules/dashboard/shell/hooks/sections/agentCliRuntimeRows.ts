import type {
  AgentSessionSummary,
  RuntimeSummary
} from "@deskcue/protocol";
import type { SourceCard } from "@models/dashboard/sourceCards";

const AGENT_CLI_IDS = ["codex", "claude-code"] satisfies RuntimeSummary["id"][];

function formatAgentCliLabel(agentId: RuntimeSummary["id"]) {
  switch (agentId) {
    case "codex":
      return "Codex";
    case "claude-code":
      return "Claude Code";
    default:
      return agentId;
  }
}

function formatAgentCliStatus(
  source: SourceCard | undefined,
  runtime: RuntimeSummary | undefined,
  runningCount: number
) {
  if (source) {
    const runningPart = runningCount > 0 ? ` · ${runningCount} running` : "";
    return `${source.sessionCountLabel} chats${runningPart}`;
  }

  if (runtime?.installed) {
    return "installed · no chats";
  }

  return runtime?.statusText ?? "not detected";
}

export function buildAgentCliRuntimeRows(
  agentSessions: AgentSessionSummary[],
  sourceCards: SourceCard[],
  runtimes: RuntimeSummary[]
): RuntimeSummary[] {
  const runtimesById = new Map(runtimes.map((runtime) => [runtime.id, runtime]));
  const sourceCardsByAgentId = new Map(sourceCards.map((source) => [source.agentId, source]));

  return AGENT_CLI_IDS.flatMap((agentId) => {
    const runtime = runtimesById.get(agentId);
    const source = sourceCardsByAgentId.get(agentId);
    if (!runtime && !source) {
      return [];
    }

    const runningCount = agentSessions.filter(
      (session) => session.agentId === agentId && session.workState === "running"
    ).length;
    const installed = runtime?.installed === true || Boolean(source?.sessionCount);
    const running = runningCount > 0 || runtime?.running === true;

    return [{
      id: agentId,
      label: source?.label ?? runtime?.label ?? formatAgentCliLabel(agentId),
      installed,
      running,
      endpoint: runtime?.endpoint ?? null,
      modelCount: source?.sessionCount ?? runtime?.modelCount ?? 0,
      loadedModelCount: runningCount || runtime?.loadedModelCount || 0,
      lastActiveModel: runtime?.lastActiveModel ?? null,
      statusText: formatAgentCliStatus(source, runtime, runningCount)
    }];
  });
}
