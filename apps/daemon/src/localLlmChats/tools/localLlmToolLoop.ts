import type { LocalLlmRuntimeId } from "@deskcue/protocol";

export type LocalLlmToolMode = "disabled" | "read_only";

export type LocalLlmFunctionTool = {
  function: {
    description: string;
    name: LocalLlmReadOnlyToolName;
    parameters: Record<string, unknown>;
  };
  type: "function";
};

export type LocalLlmReadOnlyToolName =
  | "get_workspace_git_status"
  | "list_workspace_files"
  | "read_workspace_file"
  | "search_workspace_text";

export type LocalLlmToolLoopPlan = {
  maxCallsPerRound: number;
  maxResultBytes: number;
  maxRounds: number;
  mode: LocalLlmToolMode;
  reason: string | null;
  tools: readonly LocalLlmFunctionTool[];
};

export type ResolveLocalLlmToolLoopPlanInput = {
  /** The chat must be explicitly attached to a registered workspace. */
  hasWorkspace: boolean;
  /**
   * This comes from an actual model/runtime capability probe, not the runtime
   * name alone. Many locally installed models do not support function calls.
   */
  modelSupportsToolCalls: boolean;
  runtimeId: LocalLlmRuntimeId;
};

/**
 * The first tool loop deliberately has no shell, network, write, process or
 * MCP passthrough access. Those capabilities need separate user-facing
 * approval and auditing before they can be considered safe for a LAN daemon.
 */
export const LOCAL_LLM_READ_ONLY_TOOLS: readonly LocalLlmFunctionTool[] = [
  {
    type: "function",
    function: {
      name: "list_workspace_files",
      description: "List files below the attached DeskCue workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional relative directory path." },
          max_entries: { type: "integer", minimum: 1, maximum: 200 }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_workspace_file",
      description: "Read a UTF-8 text file below the attached DeskCue workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Required relative file path." },
          max_bytes: { type: "integer", minimum: 1, maximum: 65536 }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_workspace_text",
      description: "Search UTF-8 text files below the attached DeskCue workspace.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 256 },
          path: { type: "string", description: "Optional relative directory path." },
          max_results: { type: "integer", minimum: 1, maximum: 100 }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_workspace_git_status",
      description: "Read the current Git status for the attached DeskCue workspace.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  }
];

export function isAllowedLocalLlmReadOnlyTool(value: string): value is LocalLlmReadOnlyToolName {
  return LOCAL_LLM_READ_ONLY_TOOLS.some((tool) => tool.function.name === value);
}

function disabledPlan(reason: string): LocalLlmToolLoopPlan {
  return {
    maxCallsPerRound: 0,
    maxResultBytes: 0,
    maxRounds: 0,
    mode: "disabled",
    reason,
    tools: []
  };
}

function runtimeLabel(runtimeId: LocalLlmRuntimeId) {
  return runtimeId === "ollama" ? "Ollama" : "LM Studio";
}

export function resolveLocalLlmToolLoopPlan(
  input: ResolveLocalLlmToolLoopPlanInput
): LocalLlmToolLoopPlan {
  if (!input.hasWorkspace) {
    return disabledPlan("Attach a DeskCue workspace before enabling tools.");
  }
  if (!input.modelSupportsToolCalls) {
    return disabledPlan(`${runtimeLabel(input.runtimeId)} model does not advertise tool calling.`);
  }
  return {
    maxCallsPerRound: 4,
    maxResultBytes: 64 * 1024,
    maxRounds: 4,
    mode: "read_only",
    reason: null,
    tools: LOCAL_LLM_READ_ONLY_TOOLS
  };
}
