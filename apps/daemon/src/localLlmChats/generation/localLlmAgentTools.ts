import type { LocalLlmChatEvent } from "@deskcue/protocol";

import type {
  LocalLlmAgentMessage,
  LocalLlmAgentToolDefinition,
  LocalLlmCompletedToolCall
} from "./localLlmAgentTransport.ts";
import type {
  LocalLlmToolExecutorEvent,
  LocalLlmToolRequest
} from "../tools/localLlmToolExecutor.ts";

export const MAX_LOCAL_LLM_AGENT_ROUNDS = 4;
export const MAX_LOCAL_LLM_TOOL_CALLS_PER_ROUND = 4;
export const MAX_REQUIRED_TOOL_CALL_REPAIR_ATTEMPTS = 1;

export function toLocalLlmChatEvent(event: LocalLlmToolExecutorEvent): LocalLlmChatEvent {
  if (event.type === "action_requested") {
    return {
      id: event.eventId,
      turnId: event.turnId,
      type: event.type,
      timestamp: event.timestamp,
      toolCallId: event.toolCallId,
      actionRequest: { ...event.actionRequest, status: "pending" }
    };
  }
  return {
    id: event.eventId,
    turnId: event.turnId,
    type: event.type,
    timestamp: event.timestamp,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    ...(event.type === "tool_completed" ? { summary: event.summary } : {}),
    ...(event.type === "tool_failed" ? { error: event.error } : {})
  };
}

export function readAppliedFilePaths(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const files = (value as { files?: unknown }).files;
  return Array.isArray(files)
    ? files.flatMap((item) => typeof (item as { path?: unknown })?.path === "string" ? [(item as { path: string }).path] : [])
    : [];
}

export function buildInferenceSystemPrompt(systemPrompt: string | undefined, contextCompacted: boolean) {
  const contextNotice = contextCompacted
    ? "DeskCue context window: earlier messages were omitted to keep this local inference request bounded. Do not claim to remember omitted content."
    : "";
  return [systemPrompt?.trim() ?? "", contextNotice].filter(Boolean).join("\n\n") || undefined;
}

export function buildAgentSystemPrompt(systemPrompt: string | undefined, contextCompacted: boolean) {
  return [
    buildInferenceSystemPrompt(systemPrompt, contextCompacted),
    "When workspace work requires a tool, use the provided function-calling API. Never print a JSON representation of a tool call as assistant text. Only describe an action after the corresponding tool result is available."
  ].filter(Boolean).join("\n\n");
}

export function buildRequiredToolRepairTranscript(
  toolName: string,
  latestUserMessage: string
): LocalLlmAgentMessage[] {
  return [
    {
      role: "system",
      content: [
        "The user explicitly required a native DeskCue function call.",
        `Your next response must be exactly one function call named ${toolName} using the arguments from the user message.`,
        "Do not write assistant text, reasoning, JSON, markdown, or a final answer before the tool result."
      ].join(" ")
    },
    { role: "user", content: latestUserMessage }
  ];
}

function toolDefinition(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = []
) {
  return {
    type: "function" as const,
    function: {
      description,
      name,
      parameters: { type: "object", properties, required, additionalProperties: false }
    }
  };
}

export const LOCAL_LLM_AGENT_TOOLS: readonly LocalLlmAgentToolDefinition[] = [
  toolDefinition("list_workspace_files", "List files in the attached workspace.", {
    path: { type: "string" }, max_entries: { type: "integer", minimum: 1, maximum: 400 }
  }),
  toolDefinition("read_workspace_file", "Read a UTF-8 text file in the attached workspace.", {
    path: { type: "string" }, max_bytes: { type: "integer", minimum: 1, maximum: 65536 }
  }, ["path"]),
  toolDefinition("search_workspace_text", "Search UTF-8 text files in the attached workspace.", {
    query: { type: "string" }, path: { type: "string" }, max_results: { type: "integer", minimum: 1, maximum: 100 }
  }, ["query"]),
  toolDefinition("apply_unified_diff", "Apply a unified diff inside the attached workspace.", {
    patch: { type: "string" }
  }, ["patch"]),
  toolDefinition("run_workspace_command", "Run one executable with explicit arguments in the attached workspace.", {
    command: { type: "string" }, args: { type: "array", items: { type: "string" } }, timeout_ms: { type: "integer" }
  }, ["command"])
];

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Tool argument ${name} must be a non-empty string.`);
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

export function toLocalLlmToolRequest(toolCall: LocalLlmCompletedToolCall): LocalLlmToolRequest {
  const values = toolCall.arguments;
  switch (toolCall.name) {
    case "list_workspace_files":
      return { id: toolCall.id, name: "list_workspace_files", path: optionalString(values.path), maxEntries: optionalNumber(values.max_entries) };
    case "read_workspace_file":
      return { id: toolCall.id, name: "read_workspace_file", path: requiredString(values.path, "path"), maxBytes: optionalNumber(values.max_bytes) };
    case "search_workspace_text":
      return { id: toolCall.id, name: "search_workspace_text", query: requiredString(values.query, "query"), path: optionalString(values.path), maxResults: optionalNumber(values.max_results) };
    case "apply_unified_diff":
      return { id: toolCall.id, name: "apply_unified_diff", patch: requiredString(values.patch, "patch") };
    case "run_workspace_command":
      return { id: toolCall.id, name: "run_workspace_command", command: requiredString(values.command, "command"), args: stringArray(values.args), timeoutMs: optionalNumber(values.timeout_ms) };
    default:
      throw new Error(`Local model requested unsupported tool ${toolCall.name}.`);
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function requiredLocalLlmToolName(message: string | undefined) {
  if (!message) return null;
  const normalized = message.toLowerCase();
  const requested = LOCAL_LLM_AGENT_TOOLS.find((tool) => {
    const escapedName = escapeRegExp(tool.function.name);
    return new RegExp(`(?:call|invoke|use|run)[\\s\\S]{0,96}?[\\"\\x60']?${escapedName}[\\"\\x60']?`, "i").test(normalized);
  });
  return requested?.function.name ?? null;
}
