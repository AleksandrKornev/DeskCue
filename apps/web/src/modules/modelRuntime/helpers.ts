import type {
  AgentSessionDetail,
  AgentSessionSummary,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";

import type {
  BuildModelRuntimeDetailItemsInput,
  ModelRuntimeAdapterDetails,
  ModelRuntimeDetailItem,
  ModelRuntimeModelInfo
} from "./types";

const ADAPTER_DETAILS: Record<string, ModelRuntimeAdapterDetails> = {
  codex: {
    label: "Codex",
    runtimeKind: "agent-cli",
    capabilities: "discover, attach, resume"
  },
  "claude-code": {
    label: "Claude Code",
    runtimeKind: "agent-cli",
    capabilities: "discover, attach, resume"
  },
  "lm-studio": {
    label: "LM Studio",
    runtimeKind: "llm-runtime",
    capabilities: "discover, review-only"
  },
  "generic-cli": {
    label: "Generic CLI",
    runtimeKind: "generic-cli",
    capabilities: "start"
  }
};

export function getAdapterDetails(
  adapterId: string,
  agentLabel: string | null | undefined
): ModelRuntimeAdapterDetails {
  return ADAPTER_DETAILS[adapterId] ?? {
    label: agentLabel ?? adapterId,
    runtimeKind: "unknown",
    capabilities: "unknown"
  };
}

function formatContextCompactionCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value <= 0) {
    return "0";
  }

  return String(value);
}

function formatRuntimePolicy(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildModelRuntimeDetailItems({
  adapterDetails,
  agentSession,
  mode,
  model,
  session
}: BuildModelRuntimeDetailItemsInput): ModelRuntimeDetailItem[] {
  return [
    { label: "Model", value: model.name },
    { label: "Model source", value: model.source },
    { label: "Runtime", value: agentSession?.agentLabel ?? adapterDetails.label },
    { label: "Kind", value: adapterDetails.runtimeKind },
    { label: "Mode", value: mode },
    {
      label: "Context compactions",
      value: formatContextCompactionCount(agentSession?.contextCompactionCount)
    },
    { label: "Approval policy", value: formatRuntimePolicy(agentSession?.approvalPolicy) },
    { label: "Sandbox", value: formatRuntimePolicy(agentSession?.sandboxMode) },
    { label: "Client / originator", value: agentSession?.originator },
    { label: "Capabilities", value: adapterDetails.capabilities },
    { label: "CLI version", value: agentSession?.cliVersion },
    { label: "Source", value: agentSession?.source },
    { label: "Workspace", value: agentSession?.workspacePath ?? session?.workspaceName },
    { label: "Source session", value: agentSession?.sourceSessionId ?? session?.sourceSessionId },
    { label: "Managed session", value: session?.id },
    { label: "Command", value: session?.command },
    { label: "Config source", value: agentSession?.filePath }
  ];
}

function getModelFromCommand(command: string | null | undefined) {
  if (!command) {
    return null;
  }

  return (
    command.match(/(?:^|\s)(?:-m|--model)\s+"([^"]+)"/)?.[1] ??
    command.match(/(?:^|\s)(?:-m|--model)\s+([^\s]+)/)?.[1] ??
    null
  );
}

export function getModelInfo(
  agentSession: AgentSessionDetail | AgentSessionSummary | null | undefined,
  session: SessionDetail | SessionSummary | null | undefined
): ModelRuntimeModelInfo {
  const commandModel = getModelFromCommand(session?.command);
  if (commandModel) {
    return { name: commandModel, source: "Command argument" };
  }

  if (agentSession?.model) {
    return { name: agentSession.model, source: "Agent metadata" };
  }

  const adapterId = session?.adapterId ?? agentSession?.agentId;
  if (adapterId === "claude-code" || adapterId === "lm-studio") {
    return {
      name: agentSession?.originator ?? null,
      source: agentSession?.originator ? "Agent metadata" : null
    };
  }

  return { name: null, source: null };
}

export function getMode(
  agentSession: AgentSessionDetail | AgentSessionSummary | null | undefined,
  session: SessionDetail | SessionSummary | null | undefined
) {
  if (agentSession?.attachMode === "read_only" || session?.status === "read_only") {
    return "read-only";
  }

  if (
    (agentSession?.agentId === "other" && agentSession.agentLabel === "LM Studio") ||
    session?.adapterId === "lm-studio"
  ) {
    return "review-only";
  }

  if (agentSession?.attachMode === "resume" || session?.sourceSessionId) {
    return "resumable";
  }

  return session?.status ?? "local command";
}

export function formatValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Not available";
}
