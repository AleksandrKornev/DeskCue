import { isPreviewNetworkMode, normalizePreviewNetworkMode } from "@deskcue/protocol";
import type { PreviewConfig, SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";

import type { SessionRow, SessionSummaryRow, WorkspaceRow } from "./sqliteStateRows.ts";

type StoredPreviewConfig = Omit<PreviewConfig, "networkMode"> & {
  networkMode?: PreviewConfig["networkMode"];
};

type StoredSessionDetail = Omit<SessionDetail, "preview"> & {
  preview: StoredPreviewConfig;
};

function parseStoredEntity<T>(
  row: WorkspaceRow | SessionRow,
  validate: (value: unknown) => value is T
): T[] {
  try {
    const value: unknown = JSON.parse(row.json);
    if (!validate(value)) {
      logger.warn("Quarantining invalid persisted SQLite row", {
        id: row.id,
        message: "Persisted entity does not match the runtime storage schema."
      });
      return [];
    }
    return [value];
  } catch (error) {
    logger.warn("Skipping malformed persisted SQLite row", {
      id: row.id,
      message: error instanceof Error ? error.message : "Failed to parse row JSON."
    });
    return [];
  }
}

function hasRequiredSessionRowFields(row: SessionSummaryRow) {
  return [row.id, row.workspaceId, row.startedAt, row.lastActivityAt]
    .every((value) => typeof value === "string" && value.length > 0);
}

function isSessionStatus(value: unknown): value is SessionDetail["status"] {
  return value === "running" || value === "read_only" || value === "stopped" ||
    value === "done" || value === "failed";
}

function normalizeStoredPreview(preview: StoredPreviewConfig): PreviewConfig {
  return {
    ...preview,
    networkMode: normalizePreviewNetworkMode(preview.networkMode)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasStrings(value: Record<string, unknown>, fields: string[]) {
  return fields.every((field) => typeof value[field] === "string" && value[field].length > 0);
}

function isSessionLogLine(value: unknown): value is SessionDetail["logs"][number] {
  return isRecord(value) && hasStrings(value, ["id", "timestamp", "text"]) &&
    (value.stream === "stdout" || value.stream === "stderr" || value.stream === "system");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isWorkspaceSummary(value: unknown): value is WorkspaceSummary {
  if (!isRecord(value)) return false;
  return hasStrings(value, ["id", "name", "path", "createdAt"]) &&
    typeof value.isGitRepo === "boolean" &&
    isNullableString(value.branch);
}

export function deserializeWorkspaces(rows: WorkspaceRow[]) {
  return rows.flatMap((row) => parseStoredEntity(row, isWorkspaceSummary));
}

function isReplyState(value: unknown): value is SessionDetail["replyState"] {
  return isRecord(value) &&
    (value.phase === "idle" || value.phase === "queued" || value.phase === "sending" || value.phase === "waiting") &&
    isNullableString(value.promptText) && isNullableString(value.requestedAt);
}

function isPromptRecoveryState(value: unknown): value is SessionDetail["promptRecovery"] {
  if (value === undefined || value === null) return true;
  return isRecord(value) &&
    (value.phase === "checking" || value.phase === "outcome_unknown" || value.phase === "not_sent") &&
    isNullableString(value.promptText) && typeof value.requestedAt === "string" &&
    typeof value.retryable === "boolean";
}

function isGitSnapshot(value: unknown): value is SessionDetail["git"] {
  return isRecord(value) && typeof value.isGitRepo === "boolean" && isNullableString(value.branch) &&
    typeof value.isDirty === "boolean" && Array.isArray(value.changedFiles) &&
    value.changedFiles.every((item) => typeof item === "string") && typeof value.diff === "string" &&
    typeof value.lastUpdatedAt === "string";
}

function isActionRequest(value: unknown): value is NonNullable<SessionDetail["actionRequest"]> {
  return isRecord(value) && value.kind === "approval" && isNullableString(value.command) &&
    isNullableString(value.reason) && typeof value.requestedAt === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isPreview(value: unknown): value is StoredPreviewConfig {
  return isRecord(value) && typeof value.active === "boolean" &&
    Array.isArray(value.artifacts) &&
    (value.networkMode === undefined || isPreviewNetworkMode(value.networkMode)) &&
    isNullableNumber(value.port) && isNullableString(value.targetUrl);
}

function isSessionDetail(value: unknown): value is StoredSessionDetail {
  if (!isRecord(value)) return false;
  return hasStrings(value, [
    "id", "workspaceId", "workspaceName", "adapterId", "command", "startedAt", "lastActivityAt"
  ]) &&
    isNullableString(value.sourceSessionId) &&
    isSessionStatus(value.status) &&
    isNullableString(value.finishedAt) &&
    (value.exitCode === null || typeof value.exitCode === "number") &&
    isPreview(value.preview) &&
    isReplyState(value.replyState) &&
    isPromptRecoveryState(value.promptRecovery) &&
    isGitSnapshot(value.git) &&
    Array.isArray(value.logs) && value.logs.every(isSessionLogLine) &&
    Array.isArray(value.inputHistory) && value.inputHistory.every((item) => typeof item === "string");
}

export function deserializeFullSessions(rows: SessionRow[]) {
  return rows
    .flatMap((row) => parseStoredEntity(row, isSessionDetail))
    .map((session) => ({
      ...session,
      preview: normalizeStoredPreview(session.preview)
    }));
}

function parseJsonValue<T>(value: unknown, validate: (value: unknown) => value is T): T | null {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildLightweightSession(row: SessionSummaryRow): SessionDetail[] {
  if (!isSessionStatus(row.status) || !hasRequiredSessionRowFields(row)) {
    logger.warn("Quarantining invalid persisted SQLite session summary", { id: row.id });
    return [];
  }
  const preview = parseJsonValue(row.previewJson, isPreview);
  const replyState = parseJsonValue(row.replyStateJson, isReplyState);
  const actionRequest = parseJsonValue(row.actionRequestJson, isActionRequest);
  const git = parseJsonValue(row.gitJson, isGitSnapshot);

  return [{
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName ?? row.workspaceId,
    adapterId: row.adapterId ?? "generic-cli",
    sourceSessionId: row.sourceSessionId ?? null,
    command: row.command ?? "",
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    lastActivityAt: row.lastActivityAt,
    exitCode: typeof row.exitCode === "number" ? row.exitCode : null,
    preview: preview ? normalizeStoredPreview(preview) : {
      active: false,
      artifacts: [],
      networkMode: "device-direct",
      port: null,
      targetUrl: null
    },
    replyState: replyState ?? {
      phase: "idle",
      promptText: null,
      requestedAt: null
    },
    actionRequest: actionRequest ?? null,
    git: {
      isGitRepo: git?.isGitRepo ?? false,
      branch: git?.branch ?? null,
      isDirty: git?.isDirty ?? false,
      changedFiles: [],
      diff: "",
      lastUpdatedAt: git?.lastUpdatedAt ?? row.lastActivityAt
    },
    logs: [],
    inputHistory: []
  }];
}

export function deserializeLightweightSessions(rows: SessionSummaryRow[]) {
  return rows.flatMap(buildLightweightSession);
}
