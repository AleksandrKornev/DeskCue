import {
  isPreviewNetworkMode,
  type PreviewConfig,
  type PreviewNetworkMode
} from "./preview.ts";
import {
  ProtocolSchemaError
} from "./schema.ts";
import type { GitSnapshot } from "./sessions.ts";

export type LocalLlmRuntimeId = "ollama" | "lm-studio";

export type LocalLlmGenerationState =
  | "idle"
  | "running"
  | "waiting_approval"
  | "failed"
  | "interrupted";

/**
 * DeskCue controls what a local model may do inside the workspace explicitly
 * attached to its chat. Full access is the normal DeskCue agent mode.
 */
export type LocalLlmAgentMode =
  | "read_only"
  | "ask"
  | "auto_workspace"
  | "full_access";

export type LocalLlmToolCapabilitySource =
  | "ollama_model_metadata"
  | "lm_studio_model_metadata"
  | "runtime_metadata_does_not_advertise_tools"
  | "runtime_metadata_unavailable";

export interface LocalLlmToolCapability {
  checkedAt: string;
  modelSupportsToolCalls: boolean;
  source: LocalLlmToolCapabilitySource;
}

export interface LocalLlmActionRequest {
  id: string;
  turnId: string;
  toolCallId: string;
  action: "apply_unified_diff" | "run_workspace_command";
  summary: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
}

export type LocalLlmChatEventType =
  | "turn_started"
  | "assistant_message_saved"
  | "turn_completed"
  | "turn_failed"
  | "turn_interrupted"
  | "turn_interrupted_after_restart"
  | "model_reasoning_saved"
  | "tool_requested"
  | "tool_completed"
  | "tool_failed"
  | "action_requested"
  | "action_resolved";

/**
 * A durable DeskCue lifecycle or model-output fact. `model_reasoning_saved`
 * is emitted only when a local runtime explicitly exposes reasoning output.
 */
export interface LocalLlmChatEvent {
  id: string;
  turnId: string;
  type: LocalLlmChatEventType;
  timestamp: string;
  messageId?: string;
  error?: string;
  toolCallId?: string;
  toolName?: string;
  summary?: string;
  actionRequest?: LocalLlmActionRequest;
}

export interface LocalLlmChatChangeSet {
  id: string;
  turnId: string;
  timestamp: string;
  changedFiles: string[];
  diff: string;
  /**
   * Full patch text lives in a compressed sidecar and is hydrated only when
   * the user opens this change group. Legacy records keep the inline diff.
   */
  diffStorage?: "inline" | "gzip_sidecar";
  attribution:
    | "workspace_state_observed_between_snapshots"
    | "applied_by_deskcue_local_agent";
}

export interface LocalLlmChatHistoryCursor {
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Cursors are independent because messages, lifecycle facts and change sets
 * are durable append-only streams with different retention characteristics.
 */
export interface LocalLlmChatHistoryPageInfo {
  messages: LocalLlmChatHistoryCursor;
  events: LocalLlmChatHistoryCursor;
  changeSets: LocalLlmChatHistoryCursor;
}

export interface LocalLlmChatWorkspace {
  id: string;
  name: string;
  path: string;
}

export interface LocalLlmChatSummary {
  id: string;
  title: string;
  runtimeId: LocalLlmRuntimeId;
  model: string;
  /**
   * The registered DeskCue workspace that this chat is allowed to observe.
   * `null` keeps standalone local-model conversations independent from a
   * workspace.
   */
  workspace: LocalLlmChatWorkspace | null;
  createdAt: string;
  updatedAt: string;
  generationState: LocalLlmGenerationState;
  generationError: string | null;
  agentMode: LocalLlmAgentMode;
  toolCapability: LocalLlmToolCapability | null;
  /** Preview settings belong to this DeskCue-owned local chat, not to the runtime. */
  preview?: PreviewConfig;
}

export interface LocalLlmChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  status: "complete" | "interrupted" | "interrupted_after_restart";
}

export interface LocalLlmPendingPrompt {
  requestedAt: string;
  reason?: "server_off" | "model_unloaded";
  text: string;
}

export interface LocalLlmChatDetail extends LocalLlmChatSummary {
  /** Compact original prompt for the session header; list views keep `title`. */
  headerTitle?: string | null;
  messages: LocalLlmChatMessage[];
  events: LocalLlmChatEvent[];
  changeSets: LocalLlmChatChangeSet[];
  pendingAssistantText: string | null;
  pendingLmStudioPrompt: LocalLlmPendingPrompt | null;
  actionRequests: LocalLlmActionRequest[];
  history: LocalLlmChatHistoryPageInfo;
  /** Bounded, read-only snapshot of the attached workspace working tree. */
  git?: GitSnapshot;
}

export interface LocalLlmChatsResponse {
  chats: LocalLlmChatSummary[];
}

export interface CreateLocalLlmChatInput {
  runtimeId: LocalLlmRuntimeId;
  model: string;
  workspaceId?: string | null;
}

export interface UpdateLocalLlmChatWorkspaceInput {
  workspaceId: string | null;
}

export interface UpdateLocalLlmChatModelInput {
  model: string;
}

export interface UpdateLocalLlmChatAgentModeInput {
  agentMode: LocalLlmAgentMode;
}

export interface UpdateLocalLlmChatPreviewInput {
  port: number | null;
  networkMode?: PreviewNetworkMode;
}

export interface SendLocalLlmChatMessageInput {
  text: string;
}

export interface SaveLocalLlmPendingPromptInput {
  text: string;
}

export function parseCreateLocalLlmChatInput(value: unknown): CreateLocalLlmChatInput {
  const body = readLocalLlmObject(value);
  const runtimeId = body.runtimeId;
  const model = readTrimmedString(
    body.model,
    "Choose a local model before starting a chat."
  );
  if (runtimeId !== "ollama" && runtimeId !== "lm-studio") {
    throw new ProtocolSchemaError("Choose Ollama or LM Studio for this local chat.");
  }

  return {
    runtimeId,
    model,
    workspaceId: readOptionalWorkspaceId(body.workspaceId)
  };
}

export function parseUpdateLocalLlmChatWorkspaceInput(
  value: unknown
): UpdateLocalLlmChatWorkspaceInput {
  const workspaceId = readOptionalWorkspaceId(readLocalLlmObject(value).workspaceId);
  if (workspaceId === undefined) {
    throw new ProtocolSchemaError(
      "Choose a workspace or explicitly detach this local chat."
    );
  }
  return { workspaceId };
}

export function parseSendLocalLlmChatMessageInput(
  value: unknown
): SendLocalLlmChatMessageInput {
  return {
    text: readTrimmedString(
      readLocalLlmObject(value).text,
      "Message cannot be empty.",
      200_000
    )
  };
}

export function parseUpdateLocalLlmChatAgentModeInput(
  value: unknown
): UpdateLocalLlmChatAgentModeInput {
  const agentMode = readLocalLlmObject(value).agentMode;
  if (
    agentMode !== "read_only" &&
    agentMode !== "ask" &&
    agentMode !== "auto_workspace" &&
    agentMode !== "full_access"
  ) {
    throw new ProtocolSchemaError("Choose a valid local agent mode.");
  }
  return { agentMode };
}

export function parseUpdateLocalLlmChatModelInput(
  value: unknown
): UpdateLocalLlmChatModelInput {
  return {
    model: readTrimmedString(
      readLocalLlmObject(value).model,
      "Choose a local model before updating this chat."
    )
  };
}

export function parseSaveLocalLlmPendingPromptInput(
  value: unknown
): SaveLocalLlmPendingPromptInput {
  return {
    text: readTrimmedString(
      readLocalLlmObject(value).text,
      "Message cannot be empty."
    )
  };
}

export function parseUpdateLocalLlmChatPreviewInput(
  value: unknown
): UpdateLocalLlmChatPreviewInput {
  const body = readLocalLlmObject(value);
  const port = body.port;
  const networkMode = readOptionalPreviewNetworkMode(body.networkMode);
  if (port === null) {
    return { port: null, ...(networkMode === undefined ? {} : { networkMode }) };
  }
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ProtocolSchemaError(
      "Preview port must be an integer between 1 and 65535."
    );
  }
  return { port, ...(networkMode === undefined ? {} : { networkMode }) };
}

function readOptionalPreviewNetworkMode(value: unknown): PreviewNetworkMode | undefined {
  if (value === undefined) return undefined;
  if (!isPreviewNetworkMode(value)) {
    throw new ProtocolSchemaError(
      "Preview network mode must be device-direct or deskcue-host."
    );
  }
  return value;
}

function readLocalLlmObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new ProtocolSchemaError("Expected a request payload.");
  }
  return value as Record<string, unknown>;
}

function readTrimmedString(value: unknown, message: string, maxLength = 300) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProtocolSchemaError(message);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new ProtocolSchemaError(
      `Input exceeds the ${maxLength.toLocaleString("en-US")}-character limit.`
    );
  }
  return normalized;
}

function readOptionalWorkspaceId(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return readTrimmedString(value, "Choose a valid workspace.", 300);
}
