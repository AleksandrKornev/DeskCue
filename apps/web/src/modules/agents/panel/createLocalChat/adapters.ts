import type {
  LocalLlmRuntimeId,
  RuntimeSummary,
  WorkspaceSummary
} from "@deskcue/protocol";

import type {
  CreateLocalChatRuntimeOption,
  CreateLocalChatWorkspaceOption
} from "./types";

const LOCAL_RUNTIME_IDS: readonly LocalLlmRuntimeId[] = ["ollama", "lm-studio"];

const RUNTIME_DESCRIPTIONS: Record<LocalLlmRuntimeId, string> = {
  "lm-studio": "Uses the models installed in LM Studio.",
  ollama: "Uses the models installed in Ollama."
};

const RUNTIME_LABELS: Record<LocalLlmRuntimeId, string> = {
  "lm-studio": "LM Studio",
  ollama: "Ollama"
};

function isLocalRuntimeId(runtimeId: RuntimeSummary["id"]): runtimeId is LocalLlmRuntimeId {
  return runtimeId === "ollama" || runtimeId === "lm-studio";
}

function buildRuntimeStatusText(runtime: RuntimeSummary) {
  const parts = [];
  if (!runtime.running) {
    parts.push("Offline");
  } else if (runtime.loadedModelCount > 0) {
    parts.push(`${runtime.loadedModelCount} loaded`);
  } else {
    parts.push("Running");
  }

  if (runtime.modelCount > 0) {
    parts.push(`${runtime.modelCount} models`);
  }
  return parts.join(" · ");
}

export function buildCreateLocalChatRuntimeOptions(
  runtimes: readonly RuntimeSummary[]
): CreateLocalChatRuntimeOption[] {
  const runtimeById = new Map(
    runtimes
      .filter((runtime) => isLocalRuntimeId(runtime.id))
      .map((runtime) => [runtime.id, runtime] as const)
  );

  return LOCAL_RUNTIME_IDS.map((runtimeId) => {
    const runtime = runtimeById.get(runtimeId);
    if (!runtime?.installed) {
      return {
        description: RUNTIME_DESCRIPTIONS[runtimeId],
        disabled: true,
        id: runtimeId,
        label: runtime?.label || RUNTIME_LABELS[runtimeId],
        status: "unavailable",
        statusText: runtime?.statusText || "Not installed"
      };
    }

    return {
      description: RUNTIME_DESCRIPTIONS[runtimeId],
      id: runtimeId,
      label: runtime.label || RUNTIME_LABELS[runtimeId],
      status: runtime.running ? "ready" : "offline",
      statusText: buildRuntimeStatusText(runtime)
    };
  });
}

export function buildCreateLocalChatWorkspaceOptions(
  workspaces: readonly WorkspaceSummary[]
): CreateLocalChatWorkspaceOption[] {
  return workspaces.map((workspace) => ({
    id: workspace.id,
    label: workspace.name,
    path: workspace.path
  }));
}

export function chooseDefaultLocalChatRuntime(
  runtimes: readonly RuntimeSummary[]
): LocalLlmRuntimeId {
  const localRuntimes = runtimes.filter(
    (runtime): runtime is RuntimeSummary & { id: LocalLlmRuntimeId } =>
      isLocalRuntimeId(runtime.id)
  );
  return localRuntimes.find((runtime) => runtime.installed && runtime.running)?.id
    ?? localRuntimes.find((runtime) => runtime.installed)?.id
    ?? "ollama";
}
