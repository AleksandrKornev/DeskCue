import { ProtocolSchemaError, readProtocolObject } from "../schema.ts";

import {
  CLOUD_REMOTE_READ_CHUNK_BYTES,
  CLOUD_REMOTE_READ_MAX_REQUEST_BYTES,
  CLOUD_REMOTE_READ_OPERATIONS
} from "./types.ts";
import type {
  CloudAgentSessionReadInput,
  CloudRemoteReadOperation,
  CloudRemoteReadOperationInput,
  CloudRemoteReadOperationInputMap,
  CloudRemoteReadRequestFrame
} from "./types.ts";
import {
  invalidReadInput,
  isBase64Chunk,
  isCloudRelativePath,
  isIdentifier,
  isIsoTimestamp,
  isOptionalSourceRanges,
  isOptionalStringArray,
  isSafeInteger,
  isSafeIntegerBetween,
  isSha256,
  isStringArrayBetween,
  isStringBetween,
  requireExactVersion,
  requireOnlyKeys
} from "./validation.ts";

export function parseCloudRemoteReadRequestFrame(
  value: unknown
): CloudRemoteReadRequestFrame {
  const frame = readProtocolObject(value);

  requireExactVersion(frame);

  if (typeof frame.type !== "string" || !frame.type.startsWith("remote.read.request.")) {
    throw new ProtocolSchemaError("Expected a Cloud remote read request frame.");
  }

  if (!isIdentifier(frame.requestId, 8, 128)) {
    throw new ProtocolSchemaError("Cloud remote read request identifier is invalid.");
  }

  if (frame.type === "remote.read.request.start") {
    requireOnlyKeys(frame, [
      "type", "protocolVersion", "requestId", "operation", "bodyBytes", "chunkCount",
      "bodySha256", "deadlineAt", "sentAt"
    ]);
    if (!CLOUD_REMOTE_READ_OPERATIONS.includes(frame.operation as CloudRemoteReadOperation) ||
        !isSafeIntegerBetween(frame.bodyBytes, 0, CLOUD_REMOTE_READ_MAX_REQUEST_BYTES) ||
        !isSafeIntegerBetween(
          frame.chunkCount,
          0,
          Math.ceil(CLOUD_REMOTE_READ_MAX_REQUEST_BYTES / CLOUD_REMOTE_READ_CHUNK_BYTES)
        ) ||
        frame.chunkCount !== Math.ceil((frame.bodyBytes as number) / CLOUD_REMOTE_READ_CHUNK_BYTES) ||
        !isSha256(frame.bodySha256) || !isIsoTimestamp(frame.deadlineAt) || !isIsoTimestamp(frame.sentAt)) {
      throw new ProtocolSchemaError("Cloud remote read request metadata is invalid.");
    }

    return frame as CloudRemoteReadRequestFrame;
  }

  if (frame.type === "remote.read.request.chunk") {
    requireOnlyKeys(frame, ["type", "protocolVersion", "requestId", "index", "data"]);
    if (!isSafeInteger(frame.index, 0) || !isBase64Chunk(frame.data)) {
      throw new ProtocolSchemaError("Cloud remote read request chunk is invalid.");
    }

    return frame as CloudRemoteReadRequestFrame;
  }

  if (frame.type === "remote.read.request.end") {
    requireOnlyKeys(frame, ["type", "protocolVersion", "requestId", "bodySha256", "sentAt"]);
    if (!isSha256(frame.bodySha256) || !isIsoTimestamp(frame.sentAt)) {
      throw new ProtocolSchemaError("Cloud remote read request end is invalid.");
    }

    return frame as CloudRemoteReadRequestFrame;
  }

  throw new ProtocolSchemaError("Unknown Cloud remote read request frame.");
}

export function parseCloudRemoteReadOperationInput<Operation extends CloudRemoteReadOperation>(
  operation: Operation,
  value: unknown
): CloudRemoteReadOperationInputMap[Operation];
export function parseCloudRemoteReadOperationInput(
  operation: CloudRemoteReadOperation,
  value: unknown
): CloudRemoteReadOperationInput {
  if (!CLOUD_REMOTE_READ_OPERATIONS.includes(operation)) invalidReadInput();
  const input = readProtocolObject(value);

  // Overview and sessions.
  if (operation === "overview.get") {
    requireOnlyKeys(input, ["sessionLimit"]);
    if (input.sessionLimit !== undefined && !isSafeIntegerBetween(input.sessionLimit, 1, 200)) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["overview.get"];
  }

  if (operation === "managedSessions.get") {
    requireOnlyKeys(input, ["sessionId", "view", "debugLogTail"]);
    if (!isStringBetween(input.sessionId, 1, 512) ||
        (input.view !== undefined && input.view !== "chat" && input.view !== "debug" && input.view !== "diff") ||
        (input.debugLogTail !== undefined && !isSafeIntegerBetween(input.debugLogTail, 0, 10_000))) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["managedSessions.get"];
  }

  if (operation === "sessions.list") {
    requireOnlyKeys(input, ["includeLiveMetadata", "limit", "offset", "query", "sourceId"]);
    if (input.includeLiveMetadata !== undefined && typeof input.includeLiveMetadata !== "boolean") invalidReadInput();
    if (input.limit !== undefined && !isSafeIntegerBetween(input.limit, 1, 200)) invalidReadInput();
    if (input.offset !== undefined && !isSafeIntegerBetween(input.offset, 0, 100_000)) invalidReadInput();
    if (input.query !== undefined && !isStringBetween(input.query, 0, 256)) invalidReadInput();
    if (input.sourceId !== undefined && !isStringBetween(input.sourceId, 1, 64)) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["sessions.list"];
  }

  if (operation === "sessions.resolveRoute") {
    requireOnlyKeys(input, ["cloudSessionId"]);
    if (typeof input.cloudSessionId !== "string" ||
        !/^sess_[a-f0-9]{64}$/u.test(input.cloudSessionId)) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["sessions.resolveRoute"];
  }

  if (operation === "sessions.reviewed.post") {
    requireOnlyKeys(input, ["agentSessionId"]);
    if (!isStringBetween(input.agentSessionId, 1, 512)) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["sessions.reviewed.post"];
  }

  // Transcript and change evidence.
  if (operation === "transcript.page") {
    requireOnlyKeys(input, ["agentSessionId", "beforeEntryId", "limit"]);
    if (!isStringBetween(input.agentSessionId, 1, 512) ||
        !isStringBetween(input.beforeEntryId, 1, 512) ||
        (input.limit !== undefined && !isSafeIntegerBetween(input.limit, 1, 50))) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["transcript.page"];
  }

  if (operation === "transcript.entries.get" || operation === "transcript.entries.post") {
    requireOnlyKeys(input, ["agentSessionId", "entryIds"]);
    if (!isStringBetween(input.agentSessionId, 1, 512) ||
        !isStringArrayBetween(input.entryIds, 1, 200, 512)) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap[
      "transcript.entries.get" | "transcript.entries.post"
    ];
  }

  if (operation === "changes.get" || operation === "changes.post") {
    requireOnlyKeys(input, ["agentSessionId", "groupId", "sourceEntryIds", "sourceEntryRanges", "sourceEntrySpans"]);
    if (!isStringBetween(input.agentSessionId, 1, 512) || !isStringBetween(input.groupId, 1, 512) ||
        !isOptionalStringArray(input.sourceEntryIds, 2_000) || !isOptionalSourceRanges(input.sourceEntryRanges) ||
        !isOptionalSourceRanges(input.sourceEntrySpans)) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["changes.get" | "changes.post"];
  }

  // Workspace and Preview resources.
  if (operation === "assets.ticket.create") {
    requireOnlyKeys(input, ["agentSessionId", "download", "kind", "managedSessionId", "path", "workspaceId"]);
    if ((input.agentSessionId !== undefined && !isStringBetween(input.agentSessionId, 1, 512)) ||
        (input.managedSessionId !== undefined && !isStringBetween(input.managedSessionId, 1, 512)) ||
        (input.workspaceId !== undefined && !isStringBetween(input.workspaceId, 1, 512)) ||
        (input.download !== undefined && typeof input.download !== "boolean") ||
        (input.kind !== "file" && input.kind !== "local_image") ||
        !isStringBetween(input.path, 1, 4096) || input.path.includes("\0")) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["assets.ticket.create"];
  }

  if (operation === "assets.ticket.read") {
    requireOnlyKeys(input, ["ticket"]);
    if (!isStringBetween(input.ticket, 8, 128) ||
        !/^[A-Za-z0-9_-]+$/u.test(input.ticket)) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["assets.ticket.read"];
  }

  if (operation === "workspace.files.list") {
    requireOnlyKeys(input, ["workspaceId", "path", "cursor", "limit"]);
    if (!isStringBetween(input.workspaceId, 1, 512) ||
        (input.path !== undefined && !isCloudRelativePath(input.path, true)) ||
        (input.cursor !== undefined && input.cursor !== null &&
          (!isStringBetween(input.cursor, 3, 4096) || !/^n_[A-Za-z0-9_-]+$/u.test(input.cursor))) ||
        (input.limit !== undefined && !isSafeIntegerBetween(input.limit, 1, 100))) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["workspace.files.list"];
  }

  if (operation === "workspace.files.read") {
    requireOnlyKeys(input, ["workspaceId", "path"]);
    if (!isStringBetween(input.workspaceId, 1, 512) || !isCloudRelativePath(input.path, false)) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["workspace.files.read"];
  }

  if (operation === "managed.git.refresh") {
    requireOnlyKeys(input, ["sessionId", "view"]);
    if (!isStringBetween(input.sessionId, 1, 512) ||
        (input.view !== undefined && input.view !== "diff")) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["managed.git.refresh"];
  }

  if (operation === "preview.candidates") {
    requireOnlyKeys(input, ["kind", "ownerId"]);
    if (input.kind !== "session" || !isStringBetween(input.ownerId, 1, 200)) invalidReadInput();
    return input as CloudRemoteReadOperationInputMap["preview.candidates"];
  }

  // Shared session-detail options.
  requireOnlyKeys(input, [
    "agentSessionId", "baseItemKey", "baseSourceEntryId", "chatMessageTail", "fullTranscript",
    "includeSessionSummary", "omitTranscript", "overlapItemCount", "transcriptDetail",
    "transcriptTail", "waitingSince"
  ]);
  if (!isStringBetween(input.agentSessionId, 1, 512)) invalidReadInput();
  for (const key of ["baseItemKey", "baseSourceEntryId"] as const) {
    if (input[key] !== undefined && input[key] !== null && !isStringBetween(input[key], 1, 512)) invalidReadInput();
  }

  for (const key of ["chatMessageTail", "overlapItemCount", "transcriptTail"] as const) {
    if (input[key] !== undefined && !isSafeIntegerBetween(input[key], 0, 10_000)) invalidReadInput();
  }

  for (const key of ["fullTranscript", "includeSessionSummary", "omitTranscript"] as const) {
    if (input[key] !== undefined && typeof input[key] !== "boolean") invalidReadInput();
  }

  if (
    input.transcriptDetail !== undefined &&
    input.transcriptDetail !== "full" &&
    input.transcriptDetail !== "summary"
  ) invalidReadInput();
  if (
    input.waitingSince !== undefined &&
    input.waitingSince !== null &&
    !isIsoTimestamp(input.waitingSince)
  ) invalidReadInput();
  return input as CloudAgentSessionReadInput;
}
