import {
  isPreviewNetworkMode,
  type PreviewConfig,
  type PreviewNetworkMode,
  type PreviewViewport
} from "./preview.ts";
import type {
  AgentKind,
  AgentSessionSummary,
  CodexApprovalPolicy,
  CodexSandboxMode,
  ExternalForceStopTarget
} from "./sessions/agentSession.ts";
export type {
  AgentKind,
  AgentSessionInterruptLifecycle,
  AgentSessionObservedTurnState,
  AgentSessionSubagent,
  AgentSessionSummary,
  CodexApprovalPolicy,
  CodexSandboxMode,
  ExternalClaudeBackgroundStopCapability,
  ExternalDesktopInterruptCapability,
  ExternalForceStopCapability,
  ExternalForceStopTarget
} from "./sessions/agentSession.ts";
import {
  ProtocolSchemaError,
  readOptionalProtocolString,
  readProtocolObject,
  readRequiredProtocolString
} from "./schema.ts";
import type {
  AgentTranscriptEntry,
  AgentTranscriptViewResponse,
  CodexTranscriptEntry
} from "./transcript.ts";

export type SessionStatus =
  | "running"
  | "read_only"
  | "stopped"
  | "done"
  | "failed";

export type LogStream = "stdout" | "stderr" | "system";

export type RuntimeKind =
  | "ollama"
  | "lm-studio"
  | "codex"
  | "claude-code";

export interface WorkspaceSummary {
  id: string;
  name: string;
  path: string;
  isGitRepo: boolean;
  branch: string | null;
  createdAt: string;
}

export interface SessionLogLine {
  id: string;
  timestamp: string;
  stream: LogStream;
  text: string;
}

export type GitFileStatus = "M" | "A" | "D" | "R" | "C" | "U" | "?";

export interface GitSnapshot {
  isGitRepo: boolean;
  branch: string | null;
  isDirty: boolean;
  changedFiles: string[];
  /** Porcelain-v1 status keyed by the current workspace-relative path. */
  changedFileStatuses?: Record<string, GitFileStatus>;
  /** Previous workspace-relative path for native Git renames and copies. */
  changedFilePreviousPaths?: Record<string, string>;
  diff: string;
  /** True when the daemon retained only a bounded prefix of the workspace diff. */
  diffTruncated?: boolean;
  lastUpdatedAt: string;
}

export interface ReplyState {
  deliveryRequestedAt?: string | null;
  phase: "idle" | "queued" | "sending" | "waiting";
  promptText: string | null;
  requestedAt: string | null;
  sourcePromptObserved?: boolean;
}

export interface PromptRecoveryState {
  observedPromptAt?: string | null;
  phase: "checking" | "outcome_unknown" | "not_sent";
  promptText: string | null;
  requestedAt: string;
  retryable: boolean;
}

export interface SessionActionRequest {
  kind: "approval";
  command: string | null;
  reason: string | null;
  requestedAt: string;
}

export interface SessionSummary {
  id: string;
  workspaceId: string;
  workspaceName: string;
  adapterId: string;
  sourceSessionId: string | null;
  sourceSessionFilePath?: string | null;
  command: string;
  status: SessionStatus;
  startedAt: string;
  finishedAt: string | null;
  lastActivityAt: string;
  exitCode: number | null;
  preview: PreviewConfig;
  replyState: ReplyState;
  promptRecovery?: PromptRecoveryState | null;
  actionRequest?: SessionActionRequest | null;
  git: GitSnapshot;
  viewerCount?: number;
  canSendInput?: boolean;
  inputBlockedReason?: string | null;
}

export interface SessionDetail extends SessionSummary {
  logs: SessionLogLine[];
  inputHistory: string[];
}

export interface ExternalDesktopInterruptFallback {
  kind: "external_desktop_fallback";
  code: "external_desktop_interrupt_unavailable";
  action: "open_on_host";
  message: string;
}

export interface AgentSessionDetail extends AgentSessionSummary {
  transcript: AgentTranscriptEntry[];
  transcriptView?: AgentTranscriptViewResponse;
}

export interface AgentSessionsResponse {
  sessions: AgentSessionSummary[];
  limit: number;
  offset: number;
  hasMore: boolean;
  query: string | null;
  totalCount: number;
  totalCountExact: boolean;
  sourceCounts: AgentSessionSourceCount[];
  indexSnapshot?: AgentSessionIndexSnapshotMeta;
}

export interface AgentSessionSourceCount {
  agentId: AgentKind;
  count: number;
  exact: boolean;
}

export interface AgentSessionIndexSnapshotMeta {
  ageMs: number | null;
  cachedAt: string | null;
  readMode: "live" | "snapshot-fresh" | "snapshot-stale" | "snapshot-miss";
  refreshing: boolean;
  sessionCount: number;
  storage: "memory" | "disk" | "none";
}

export interface SourceAgentIndexStatsResponse {
  filePath: string | null;
  refreshingCount: number;
  snapshotCount: number;
  snapshotTtlMs: number;
  snapshots: Array<{
    ageMs: number | null;
    cacheKeyHash: string;
    cachedAt: string | null;
    sessionCount: number;
    storage: "memory" | "disk";
  }>;
}

export interface AgentSessionSourceVersion {
  summary: AgentSessionSummary;
  sourceFileMtimeMs: number | null;
  sourceFileSizeBytes: number | null;
  sourceVersion: string;
  localStateVersion?: string | null;
}

export interface CodexSessionSummary {
  id: string;
  threadName: string;
  workspacePath: string;
  workspaceName: string;
  updatedAt: string;
  model: string | null;
  originator: string | null;
  cliVersion: string | null;
  source: string | null;
  filePath: string;
  contextCompactionCount?: number;
  approvalPolicy: CodexApprovalPolicy | null;
  sandboxMode: CodexSandboxMode | null;
}

export interface CodexSessionDetail extends CodexSessionSummary {
  transcript: CodexTranscriptEntry[];
}

export interface OverviewResponse {
  clientContext: {
    canOpenNativeDialogs: boolean;
  };

  workspaces: WorkspaceSummary[];
  sessions: SessionSummary[];
}

export interface CreateWorkspaceInput {
  path: string;
}

export interface PickWorkspaceResult {
  cancelled: boolean;
  path: string | null;
}

export interface CreateSessionInput {
  workspaceId: string;
  command: string;
}

export interface RunManualCommandInput {
  workspaceId: string;
  command: string;
}

export interface ManualCommandResult {
  status: "finished" | "started";
  ok: boolean;
  exitCode: number | null;
  pid: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

export interface SendInputPayload {
  input: string;
}

export interface ExternalForceStopPayload extends ExternalForceStopTarget {}

export interface SetPreviewPortPayload {
  port: number | null;
  networkMode?: PreviewNetworkMode;
}

export interface CapturePreviewArtifactPayload {
  viewport: PreviewViewport;
}

export interface ResumeCodexSessionInput {
  prompt?: string;
}

export interface ResumeAgentSessionInput {
  prompt?: string;
}

export function parseCreateWorkspaceInput(value: unknown): CreateWorkspaceInput {
  const body = readProtocolObject(value);

  return {
    path: readRequiredProtocolString(body, "path")
  };
}

export function parseCreateSessionInput(value: unknown): CreateSessionInput {
  const body = readProtocolObject(value);

  return {
    workspaceId: readRequiredProtocolString(body, "workspaceId"),
    command: readRequiredProtocolString(body, "command")
  };
}

export function parseRunManualCommandInput(value: unknown): RunManualCommandInput {
  const body = readProtocolObject(value);

  return {
    workspaceId: readRequiredProtocolString(body, "workspaceId"),
    command: readRequiredProtocolString(body, "command")
  };
}

export function parseSendInputPayload(value: unknown): SendInputPayload {
  const body = readProtocolObject(value);

  return {
    input: readRequiredProtocolString(body, "input")
  };
}

export function parseExternalForceStopPayload(value: unknown): ExternalForceStopPayload {
  const body = readProtocolObject(value);
  const processId = body.processId;
  const processCreatedAt = body.processCreatedAt;

  if (typeof processId !== "number" || !Number.isSafeInteger(processId) || processId <= 0) {
    throw new ProtocolSchemaError("Field processId must be a positive safe integer.");
  }

  if (typeof processCreatedAt !== "string" || !processCreatedAt.trim()) {
    throw new ProtocolSchemaError("Field processCreatedAt must be a non-empty string.");
  }

  return {
    processId,
    processCreatedAt: processCreatedAt.trim()
  };
}

export function parseSetPreviewPortPayload(value: unknown): SetPreviewPortPayload {
  const body = readProtocolObject(value);
  const port = body.port;
  const networkMode = readOptionalPreviewNetworkMode(body.networkMode);

  if (port === null) {
    return {
      port: null,
      ...(networkMode === undefined ? {} : { networkMode })
    };
  }

  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ProtocolSchemaError(
      "Field port must be an integer between 1 and 65535, or null."
    );
  }

  return {
    port,
    ...(networkMode === undefined ? {} : { networkMode })
  };
}

function readOptionalPreviewNetworkMode(value: unknown): PreviewNetworkMode | undefined {
  if (value === undefined) return undefined;

  if (!isPreviewNetworkMode(value)) {
    throw new ProtocolSchemaError(
      "Field networkMode must be device-direct or deskcue-host."
    );
  }

  return value;
}

export function parseCapturePreviewArtifactPayload(
  value: unknown
): CapturePreviewArtifactPayload {
  const body = readProtocolObject(value);
  const viewport = body.viewport;

  if (viewport !== "desktop" && viewport !== "mobile") {
    throw new ProtocolSchemaError("Field viewport must be desktop or mobile.");
  }

  return {
    viewport
  };
}

export function parseResumeAgentSessionInput(value: unknown): ResumeAgentSessionInput {
  const body = readProtocolObject(value);

  return {
    prompt: readOptionalProtocolString(body, "prompt")
  };
}

export function parseResumeCodexSessionInput(value: unknown): ResumeCodexSessionInput {
  const body = readProtocolObject(value);

  return {
    prompt: readOptionalProtocolString(body, "prompt")
  };
}
