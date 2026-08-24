import type { ServerEvent } from "../realtime.ts";
import {
  ProtocolSchemaError,
  readProtocolObject
} from "../schema.ts";
import {
  requireBoolean,
  requireNonNegativeNumber,
  requireNullableOneOf,
  requireNullableStrings,
  requireOneOf,
  requireOptionalBoolean,
  requireOptionalNonNegativeNumber,
  requireOptionalNullableNonNegativeNumber,
  requireOptionalNullableOneOf,
  requireOptionalNullableStrings,
  requireStringArray,
  requireStrings
} from "./realtime.ts";

function validateAgentTurnState(value: unknown) {
  const turnState = readProtocolObject(value);

  requireNullableStrings(turnState, "activityAt", "completedAt", "fingerprint", "startedAt");
  requireStrings(turnState, "evidence", "phase");
  requireOneOf(turnState, "phase", ["idle", "active", "completed", "failed", "interrupted"]);
  requireOneOf(turnState, "evidence", [
    "none",
    "recent_non_final_activity",
    "terminal_lifecycle",
    "turn_lifecycle",
    "unanswered_user_turn",
    "user_after_terminal"
  ]);
}

function validateAgentSessionSummary(payload: Record<string, unknown>) {
  requireStrings(
    payload,
    "id",
    "agentId",
    "agentLabel",
    "sourceSessionId",
    "title",
    "updatedAt",
    "filePath",
    "attachMode",
    "workState"
  );

  requireNullableStrings(
    payload,
    "workspacePath",
    "workspaceName",
    "model",
    "originator",
    "cliVersion",
    "source"
  );

  requireOneOf(payload, "agentId", ["codex", "claude-code", "other"]);
  requireOneOf(payload, "attachMode", ["resume", "read_only"]);
  requireOneOf(payload, "workState", ["idle", "running"]);
  requireOptionalNullableOneOf(payload, "approvalPolicy", [
    "untrusted",
    "on-failure",
    "on-request",
    "never"
  ]);
  requireOptionalNullableOneOf(payload, "sandboxMode", [
    "read-only",
    "workspace-write",
    "danger-full-access"
  ]);
  if (
    payload.contextCompactionCount !== undefined &&
    (
      typeof payload.contextCompactionCount !== "number" ||
      !Number.isSafeInteger(payload.contextCompactionCount) ||
      payload.contextCompactionCount < 0
    )
  ) {
    throw new ProtocolSchemaError("Server event field contextCompactionCount must be a non-negative integer.");
  }

  requireOptionalNullableStrings(payload, "attachModeReason", "reviewedAt");
  if (payload.turnState !== undefined) validateAgentTurnState(payload.turnState);
  if (payload.interruptLifecycle !== undefined) {
    const lifecycle = readProtocolObject(payload.interruptLifecycle);

    requireStrings(lifecycle, "phase");
    requireOneOf(lifecycle, "phase", ["idle", "requested", "confirmed", "unresolved"]);
    requireNullableStrings(lifecycle, "requestedAt", "confirmedAt", "turnFingerprint");
    requireNullableOneOf(lifecycle, "confirmation", [
      "source_terminal",
      "managed_transport",
      "verified_process"
    ]);
    requireNullableOneOf(lifecycle, "outcome", ["interrupted", "completed", "failed"]);
  }
}

function validateSessionSummary(payload: Record<string, unknown>) {
  requireStrings(
    payload,
    "id",
    "workspaceId",
    "workspaceName",
    "adapterId",
    "command",
    "status",
    "startedAt",
    "lastActivityAt"
  );

  requireNullableStrings(payload, "sourceSessionId", "finishedAt");
  requireOptionalNullableStrings(payload, "sourceSessionFilePath", "inputBlockedReason");
  requireOptionalBoolean(payload, "canSendInput");
  requireOptionalNonNegativeNumber(payload, "viewerCount");
  requireOneOf(payload, "status", ["running", "read_only", "stopped", "done", "failed"]);
  const preview = readProtocolObject(payload.preview);

  requireBoolean(preview, "active");
  requireOneOf(preview, "networkMode", ["device-direct", "deskcue-host"]);
  if (preview.port !== null && (
    typeof preview.port !== "number" || !Number.isSafeInteger(preview.port)
  )) {
    throw new ProtocolSchemaError("Server event preview port must be an integer or null.");
  }

  if (preview.targetUrl !== null && typeof preview.targetUrl !== "string") {
    throw new ProtocolSchemaError("Server event preview targetUrl must be a string or null.");
  }

  if (preview.artifacts !== undefined) {
    if (!Array.isArray(preview.artifacts)) {
      throw new ProtocolSchemaError("Server event preview artifacts must be an array when provided.");
    }

    for (const value of preview.artifacts) {
      const artifact = readProtocolObject(value);

      requireStrings(artifact, "id", "capturedAt", "targetUrl", "viewport", "source", "title");
      requireOneOf(artifact, "viewport", ["desktop", "mobile"]);
      requireOneOf(artifact, "source", ["metadata"]);
      requireStringArray(artifact, "notes");
    }
  }

  if (payload.exitCode !== null && (
    typeof payload.exitCode !== "number" || !Number.isSafeInteger(payload.exitCode)
  )) {
    throw new ProtocolSchemaError("Server event exitCode must be an integer or null.");
  }

  const replyState = readProtocolObject(payload.replyState);

  requireStrings(replyState, "phase");
  requireNullableStrings(replyState, "promptText", "requestedAt");
  requireOneOf(replyState, "phase", ["idle", "queued", "sending", "waiting"]);
  if (payload.promptRecovery !== undefined && payload.promptRecovery !== null) {
    const promptRecovery = readProtocolObject(payload.promptRecovery);

    requireStrings(promptRecovery, "phase", "requestedAt");
    requireNullableStrings(promptRecovery, "promptText");
    requireOneOf(promptRecovery, "phase", ["checking", "outcome_unknown", "not_sent"]);
    requireBoolean(promptRecovery, "retryable");
  }

  if (payload.actionRequest !== undefined && payload.actionRequest !== null) {
    const actionRequest = readProtocolObject(payload.actionRequest);

    requireStrings(actionRequest, "kind", "requestedAt");
    requireOneOf(actionRequest, "kind", ["approval"]);
    requireNullableStrings(actionRequest, "command", "reason");
  }

  const git = readProtocolObject(payload.git);

  requireBoolean(git, "isGitRepo");
  requireBoolean(git, "isDirty");
  requireNullableStrings(git, "branch");
  requireStrings(git, "diff", "lastUpdatedAt");
  if (!Array.isArray(git.changedFiles) || !git.changedFiles.every((item) => typeof item === "string")) {
    throw new ProtocolSchemaError("Server event git changedFiles must be an array of strings.");
  }
}

export function validateServerEventPayload(
  type: ServerEvent["type"],
  payload: Record<string, unknown>
) {
  switch (type) {
    case "protocol.hello":
      requireNonNegativeNumber(payload, "version");
      requireStringArray(payload, "capabilities");
      return;
    case "workspace.created":
      requireStrings(payload, "id", "name", "path", "createdAt");
      requireBoolean(payload, "isGitRepo");
      requireNullableStrings(payload, "branch");
      return;
    case "agent.session.updated":
      validateAgentSessionSummary(payload);
      return;
    case "agent.session.turn.finished":
      requireStrings(
        payload,
        "agentId",
        "agentLabel",
        "agentSessionId",
        "completedAt",
        "sourceSessionId",
        "status",
        "title"
      );

      requireOneOf(payload, "agentId", ["codex", "claude-code", "other"]);
      requireOneOf(payload, "status", ["completed", "failed", "interrupted"]);
      requireOptionalNullableStrings(payload, "answer", "startedAt", "managedSessionId");
      requireNullableStrings(payload, "workspaceName", "workspacePath");
      requireOptionalNullableNonNegativeNumber(payload, "durationMs");
      return;
    case "agent.session.transcript.updated":
      requireStrings(
        payload,
        "agentId",
        "agentLabel",
        "agentSessionId",
        "sourceSessionId",
        "updatedAt",
        "workState"
      );

      requireOneOf(payload, "agentId", ["codex", "claude-code", "other"]);
      requireOneOf(payload, "workState", ["idle", "running"]);
      requireNullableStrings(payload, "latestEntryId");
      requireNonNegativeNumber(payload, "transcriptLength");
      if (payload.turnState !== undefined) validateAgentTurnState(payload.turnState);
      return;
    case "agent.session.reviewed":
      requireStrings(payload, "agentSessionId", "reviewedAt");
      return;
    case "local.llm.chat.updated":
      requireStrings(payload, "chatId");
      requireBoolean(payload, "terminal");
      return;
    case "local.llm.chat.finished":
      requireStrings(payload, "chatId", "completedAt", "model", "runtimeId", "status", "title");
      requireOneOf(payload, "runtimeId", ["ollama", "lm-studio"]);
      requireOneOf(payload, "status", ["completed", "failed", "interrupted"]);
      requireNullableStrings(payload, "answer", "error");
      return;
    case "local.llm.chat.approval.required":
      requireStrings(payload, "action", "chatId", "model", "requestedAt", "runtimeId", "summary", "title");
      requireOneOf(payload, "action", ["apply_unified_diff", "run_workspace_command"]);
      requireOneOf(payload, "runtimeId", ["ollama", "lm-studio"]);
      return;
    case "session.created":
    case "session.updated":
    case "session.git":
    case "session.preview":
      validateSessionSummary(payload);
      return;
    case "session.log": {
      requireStrings(payload, "sessionId");
      const log = readProtocolObject(payload.log);

      requireStrings(log, "id", "timestamp", "stream", "text");
      requireOneOf(log, "stream", ["stdout", "stderr", "system"]);
    }
  }
}
