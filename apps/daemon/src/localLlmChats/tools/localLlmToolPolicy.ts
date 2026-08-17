import { randomUUID } from "node:crypto";

import { LocalLlmToolError } from "./localLlmToolTypes.ts";
import type {
  ExecuteLocalLlmToolInput,
  LocalLlmActionRequest,
  LocalLlmToolExecutorEvent,
  LocalLlmToolPolicy,
  LocalLlmToolRequest
} from "./localLlmToolTypes.ts";

export function createLocalLlmActionRequest(
  input: ExecuteLocalLlmToolInput,
  requestedAt: string
): LocalLlmActionRequest {
  const request = input.request;
  let action: LocalLlmActionRequest["action"];
  let summary: string;
  if (request.name === "apply_unified_diff") {
    action = "apply_unified_diff";
    summary = "Apply the local model's proposed file changes.";
  } else if (request.name === "run_workspace_command") {
    action = "run_workspace_command";
    summary = `Run ${request.command} in the attached workspace.`;
  } else {
    throw new LocalLlmToolError("Only write and command tools can request approval.");
  }
  return {
    action,
    id: `local-llm-action-${randomUUID()}`,
    requestedAt,
    summary,
    toolCallId: request.id,
    turnId: input.turnId
  };
}

export function createLocalLlmToolRequestedEvent(input: ExecuteLocalLlmToolInput): LocalLlmToolExecutorEvent {
  return {
    type: "tool_requested",
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    turnId: input.turnId,
    toolCallId: input.request.id,
    toolName: input.request.name
  };
}

function isLocalLlmReadTool(request: LocalLlmToolRequest) {
  return request.name === "list_workspace_files" ||
    request.name === "read_workspace_file" ||
    request.name === "search_workspace_text";
}

export function isLocalLlmToolAllowed(policy: LocalLlmToolPolicy, request: LocalLlmToolRequest) {
  if (isLocalLlmReadTool(request)) {
    return true;
  }
  if (policy === "auto_workspace") {
    return request.name === "apply_unified_diff";
  }
  return policy === "full_access";
}

export function localLlmToolRequiresApproval(policy: LocalLlmToolPolicy, request: LocalLlmToolRequest) {
  return (policy === "ask" && !isLocalLlmReadTool(request)) ||
    (policy === "auto_workspace" && request.name === "run_workspace_command");
}
