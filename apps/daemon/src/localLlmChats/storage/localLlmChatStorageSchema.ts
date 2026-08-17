import { isPreviewNetworkMode, normalizePreviewNetworkMode } from "@deskcue/protocol";
import type {
  LocalLlmActionRequest,
  LocalLlmAgentMode,
  LocalLlmChatChangeSet,
  LocalLlmChatMessage,
  LocalLlmChatSummary,
  LocalLlmChatWorkspace,
  LocalLlmPendingPrompt,
  LocalLlmToolCapability,
  PreviewArtifact,
  PreviewConfig,
  PreviewNetworkMode
} from "@deskcue/protocol";

import { MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES } from "./localLlmChatStorageLimits.ts";
import type { LocalLlmActiveTurn } from "../chat/localLlmChatEvents.ts";
import type { LocalLlmAgentMessage } from "../generation/localLlmAgentTransport.ts";
import type { LocalLlmToolRequest } from "../tools/localLlmToolExecutor.ts";

export type LocalLlmChatManifest = Omit<LocalLlmChatSummary, "generationError" | "generationState"> & {
  /** Persisted first-user-message title; absent only in legacy manifests. */
  headerTitle?: string | null;
  actionRequests?: LocalLlmActionRequest[];
  agentContinuation?: { assistantText: string; messages: LocalLlmAgentMessage[]; nextRound: number; turnId: string };
  pendingToolRequests?: Array<{ actionRequestId: string; request: LocalLlmToolRequest }>;
  pendingLmStudioPrompt?: LocalLlmPendingPrompt;
  activeTurn?: LocalLlmActiveTurn;
  lmStudioSession?: {
    mode: "history_replay" | "native_session";
    responseId: string | null;
  };
  origin?: {
    importedAt: string;
    kind: "lm-studio-desktop-import";
    sourceFileName: string;
  };
  systemPrompt?: string;
  preview?: PreviewConfig;
  version: 3;
};

type StoredPreviewConfig = Omit<PreviewConfig, "networkMode"> & {
  networkMode?: PreviewNetworkMode;
};

type StoredLocalLlmChatManifest = Omit<LocalLlmChatManifest, "preview" | "version"> & {
  /** Version 1 manifests did not have a workspace association. */
  version: 1 | 2 | 3;
  workspace?: LocalLlmChatWorkspace | null;
  agentMode?: LocalLlmAgentMode;
  toolCapability?: LocalLlmToolCapability | null;
  actionRequests?: LocalLlmActionRequest[];
  agentContinuation?: { assistantText?: string; messages: LocalLlmAgentMessage[]; nextRound: number; turnId: string };
  pendingToolRequests?: Array<{ actionRequestId: string; request: LocalLlmToolRequest }>;
  pendingLmStudioPrompt?: LocalLlmPendingPrompt;
  preview?: StoredPreviewConfig;
};

export function emptyLocalLlmPreview(): PreviewConfig {
  return {
    active: false,
    artifacts: [],
    networkMode: "device-direct",
    port: null,
    targetUrl: null
  };
}

export function isLocalLlmChatMessage(value: unknown): value is LocalLlmChatMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalLlmChatMessage>;
  return typeof candidate.id === "string" &&
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.text === "string" &&
    typeof candidate.timestamp === "string" &&
    (candidate.status === "complete" || candidate.status === "interrupted" || candidate.status === "interrupted_after_restart");
}

export function isLocalLlmChangeSet(value: unknown): value is LocalLlmChatChangeSet {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalLlmChatChangeSet>;
  return typeof candidate.id === "string" &&
    typeof candidate.turnId === "string" &&
    typeof candidate.timestamp === "string" &&
    Array.isArray(candidate.changedFiles) && candidate.changedFiles.every((filePath) => typeof filePath === "string") &&
    typeof candidate.diff === "string" &&
    (candidate.diffStorage === undefined || candidate.diffStorage === "inline" || candidate.diffStorage === "gzip_sidecar") &&
    (candidate.attribution === "workspace_state_observed_between_snapshots" ||
      candidate.attribution === "applied_by_deskcue_local_agent");
}

function isPreviewArtifact(value: unknown): value is PreviewArtifact {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PreviewArtifact>;
  return typeof candidate.id === "string" && typeof candidate.capturedAt === "string" &&
    typeof candidate.targetUrl === "string" && typeof candidate.title === "string" &&
    (candidate.viewport === "desktop" || candidate.viewport === "mobile") &&
    candidate.source === "metadata" && Array.isArray(candidate.notes) && candidate.notes.every((note) => typeof note === "string");
}

function isPreviewConfig(value: unknown): value is StoredPreviewConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredPreviewConfig>;
  return typeof candidate.active === "boolean" &&
    (candidate.networkMode === undefined || isPreviewNetworkMode(candidate.networkMode)) &&
    (candidate.port === null || (typeof candidate.port === "number" && Number.isInteger(candidate.port) && candidate.port > 0 && candidate.port <= 65535)) &&
    (candidate.targetUrl === null || typeof candidate.targetUrl === "string") &&
    (candidate.artifacts === undefined || (Array.isArray(candidate.artifacts) && candidate.artifacts.every(isPreviewArtifact)));
}

function isAgentMode(value: unknown): value is LocalLlmAgentMode {
  return value === "read_only" || value === "ask" || value === "auto_workspace" || value === "full_access";
}

function isToolCapability(value: unknown): value is LocalLlmToolCapability {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalLlmToolCapability>;
  return typeof candidate.checkedAt === "string" &&
    typeof candidate.modelSupportsToolCalls === "boolean" &&
    (candidate.source === "ollama_model_metadata" || candidate.source === "lm_studio_model_metadata" ||
      candidate.source === "runtime_metadata_does_not_advertise_tools" || candidate.source === "runtime_metadata_unavailable");
}

function isActionRequest(value: unknown): value is LocalLlmActionRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalLlmActionRequest>;
  return typeof candidate.id === "string" && typeof candidate.turnId === "string" &&
    typeof candidate.toolCallId === "string" &&
    (candidate.action === "apply_unified_diff" || candidate.action === "run_workspace_command") &&
    typeof candidate.summary === "string" && typeof candidate.requestedAt === "string" &&
    (candidate.status === "pending" || candidate.status === "approved" || candidate.status === "rejected" ||
      candidate.status === "executed" || candidate.status === "failed");
}

function isPendingLmStudioPrompt(value: unknown): value is LocalLlmPendingPrompt {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalLlmPendingPrompt>;
  return typeof candidate.requestedAt === "string" && !Number.isNaN(Date.parse(candidate.requestedAt)) &&
    (candidate.reason === undefined || candidate.reason === "server_off" || candidate.reason === "model_unloaded") &&
    typeof candidate.text === "string" && candidate.text.trim().length > 0 &&
    Buffer.byteLength(candidate.text, "utf8") <= MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES;
}

function isAgentMessage(value: unknown): value is LocalLlmAgentMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { content?: unknown; role?: unknown; toolCallId?: unknown; toolCalls?: unknown };
  if (typeof candidate.content !== "string" ||
    (candidate.role !== "system" && candidate.role !== "user" && candidate.role !== "assistant" && candidate.role !== "tool")) return false;
  if (candidate.role === "tool") return typeof candidate.toolCallId === "string";
  if (candidate.toolCalls === undefined) return true;
  return candidate.role === "assistant" && Array.isArray(candidate.toolCalls) && candidate.toolCalls.every((call) => {
    if (!call || typeof call !== "object") return false;
    const item = call as { arguments?: unknown; argumentsText?: unknown; id?: unknown; name?: unknown };
    return typeof item.id === "string" && typeof item.name === "string" && typeof item.argumentsText === "string" &&
      Boolean(item.arguments) && typeof item.arguments === "object" && !Array.isArray(item.arguments);
  });
}

function isAgentContinuation(value: unknown): value is NonNullable<LocalLlmChatManifest["agentContinuation"]> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { assistantText?: unknown; messages?: unknown; nextRound?: unknown; turnId?: unknown };
  return typeof candidate.turnId === "string" && typeof candidate.nextRound === "number" &&
    Number.isInteger(candidate.nextRound) && candidate.nextRound >= 0 &&
    (candidate.assistantText === undefined || typeof candidate.assistantText === "string") &&
    Array.isArray(candidate.messages) && candidate.messages.every(isAgentMessage);
}

function isToolRequest(value: unknown): value is LocalLlmToolRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as { id?: unknown; name?: unknown; [key: string]: unknown };
  if (typeof request.id !== "string") return false;
  switch (request.name) {
    case "list_workspace_files": return request.path === undefined || typeof request.path === "string";
    case "read_workspace_file": return typeof request.path === "string";
    case "search_workspace_text": return typeof request.query === "string";
    case "apply_unified_diff": return typeof request.patch === "string";
    case "run_workspace_command": return typeof request.command === "string" &&
      (request.args === undefined || (Array.isArray(request.args) && request.args.every((item) => typeof item === "string")));
    default: return false;
  }
}

function isPendingToolRequest(value: unknown): value is { actionRequestId: string; request: LocalLlmToolRequest } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { actionRequestId?: unknown; request?: unknown };
  return typeof candidate.actionRequestId === "string" && isToolRequest(candidate.request);
}

function isWorkspace(value: unknown): value is LocalLlmChatWorkspace {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalLlmChatWorkspace>;
  return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.path === "string";
}

function isActiveTurn(value: unknown): value is LocalLlmActiveTurn {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalLlmActiveTurn>;
  return typeof candidate.assistantMessageId === "string" && typeof candidate.startedAt === "string" &&
    typeof candidate.turnId === "string" && typeof candidate.userMessageId === "string";
}

export function parseLocalLlmChatManifest(value: unknown, chatId: string): LocalLlmChatManifest | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<StoredLocalLlmChatManifest>;
  if (
    (candidate.version !== 1 && candidate.version !== 2 && candidate.version !== 3) ||
    candidate.id !== chatId ||
    typeof candidate.title !== "string" ||
    (candidate.runtimeId !== "ollama" && candidate.runtimeId !== "lm-studio") ||
    typeof candidate.model !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    (candidate.headerTitle !== undefined && candidate.headerTitle !== null && typeof candidate.headerTitle !== "string") ||
    (candidate.workspace !== undefined && candidate.workspace !== null && !isWorkspace(candidate.workspace)) ||
    (candidate.agentMode !== undefined && !isAgentMode(candidate.agentMode)) ||
    (candidate.toolCapability !== undefined && candidate.toolCapability !== null && !isToolCapability(candidate.toolCapability)) ||
    (candidate.preview !== undefined && !isPreviewConfig(candidate.preview)) ||
    (candidate.actionRequests !== undefined && (!Array.isArray(candidate.actionRequests) || !candidate.actionRequests.every(isActionRequest))) ||
    (candidate.agentContinuation !== undefined && !isAgentContinuation(candidate.agentContinuation)) ||
    (candidate.pendingToolRequests !== undefined && (!Array.isArray(candidate.pendingToolRequests) || !candidate.pendingToolRequests.every(isPendingToolRequest))) ||
    (candidate.pendingLmStudioPrompt !== undefined && !isPendingLmStudioPrompt(candidate.pendingLmStudioPrompt)) ||
    (candidate.activeTurn !== undefined && !isActiveTurn(candidate.activeTurn))
  ) return null;
  return {
    id: candidate.id,
    headerTitle: candidate.headerTitle,
    title: candidate.title,
    runtimeId: candidate.runtimeId,
    model: candidate.model,
    agentMode: candidate.agentMode ?? "ask",
    toolCapability: candidate.toolCapability ?? null,
    actionRequests: candidate.actionRequests ?? [],
    agentContinuation: candidate.agentContinuation && {
      ...candidate.agentContinuation,
      assistantText: candidate.agentContinuation.assistantText ?? ""
    },
    pendingToolRequests: candidate.pendingToolRequests ?? [],
    pendingLmStudioPrompt: candidate.pendingLmStudioPrompt,
    workspace: candidate.workspace ?? null,
    activeTurn: candidate.activeTurn,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    lmStudioSession: candidate.lmStudioSession,
    origin: candidate.origin,
    systemPrompt: candidate.systemPrompt,
    preview: candidate.preview
      ? {
          ...candidate.preview,
          networkMode: normalizePreviewNetworkMode(candidate.preview.networkMode)
        }
      : emptyLocalLlmPreview(),
    version: 3
  };
}
