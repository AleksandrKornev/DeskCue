import { createHash } from "node:crypto";

import {
  CLOUD_REMOTE_READ_CHUNK_BYTES,
  CLOUD_REMOTE_READ_MAX_REQUEST_BYTES,
  REMOTE_CONTROL_CHUNK_BYTES,
  REMOTE_CONTROL_MAX_REQUEST_BYTES,
  parseCloudRemoteReadOperationInput,
  parseRemoteControlOperationInput
} from "@deskcue/protocol/cloud";
import type {
  CloudRelayClientFrame,
  CloudRemoteReadOperation,
  CloudRemoteReadOperationInput,
  CloudRemoteReadOperationInputMap,
  CloudRemoteReadRequestFrame,
  RemoteControlOperation,
  RemoteControlRequestFrame
} from "@deskcue/protocol/cloud";
import type { SqliteCloudConnectorStore } from "#persistence/cloud/cloudConnectorStore";

import type { CloudRemoteControlResult } from "./cloudRemoteControlExecutor.ts";
import type { CloudRemoteReadResult } from "./cloudRemoteReadExecutor.ts";
import {
  canonicalCloudJson,
  createCloudControlReceiptBody,
  createRemoteControlResponseFrames,
  createRemoteReadResponseFrames
} from "./cloudRemoteResponseFraming.ts";
import type {
  CloudRemoteRequestHandlerOptions,
  PendingRemoteControlRequest,
  PendingRemoteReadRequest,
  RequestContext
} from "./remote/cloudRemoteRequestTypes.ts";

export type {
  RemoteControlExecutor,
  RemoteReadExecutor
} from "./remote/cloudRemoteRequestTypes.ts";

const CLOUD_REMOTE_READ_MAX_IN_FLIGHT = 8;
const CLOUD_REMOTE_READ_MAX_PENDING_MS = 30_000;
const CLOUD_REMOTE_CONTROL_MAX_IN_FLIGHT = 4;
const CLOUD_REMOTE_CONTROL_MAX_PENDING_MS = 30_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 1_000;

function isWorkspaceFilesOperation(operation: CloudRemoteReadOperation) {
  return operation === "workspace.files.list" || operation === "workspace.files.read";
}

function isAssetTicketOperation(operation: CloudRemoteReadOperation) {
  return operation === "assets.ticket.create" || operation === "assets.ticket.read";
}

function isSessionScopedAssetFileRead(
  input: CloudRemoteReadOperationInput
) {
  const assetInput = input as CloudRemoteReadOperationInputMap["assets.file.read"];

  return Boolean(assetInput.agentSessionId || assetInput.managedSessionId);
}

function requiresRemoteFilesCapability(
  operation: CloudRemoteReadOperation,
  input?: CloudRemoteReadOperationInput
) {
  if (isWorkspaceFilesOperation(operation) || isAssetTicketOperation(operation)) return true;
  if (operation !== "assets.file.read") return false;

  return input ? !isSessionScopedAssetFileRead(input) : null;
}

function hasRemoteReadCapability<TConnection extends object>(
  context: RequestContext<TConnection>,
  operation: CloudRemoteReadOperation,
  input?: CloudRemoteReadOperationInput
) {
  const requiresFiles = requiresRemoteFilesCapability(operation, input);

  if (requiresFiles === true) {
    return context.profile.remoteFilesEnabled && context.filesNegotiated === true;
  }

  if (requiresFiles === false) {
    return context.profile.remoteReadEnabled && context.negotiated;
  }

  return (
    (context.profile.remoteReadEnabled && context.negotiated) ||
    (context.profile.remoteFilesEnabled && context.filesNegotiated === true)
  );
}

function remoteReadCapabilityError(
  operation: CloudRemoteReadOperation,
  input?: CloudRemoteReadOperationInput
) {
  return requiresRemoteFilesCapability(operation, input)
    ? "remote files capability was not negotiated"
    : "remote read capability was not negotiated";
}

function isPreviewControlOperation(operation: RemoteControlOperation) {
  return operation === "preview.configure" || operation === "preview.stop";
}

function boundedDeadline(deadlineAt: string, maximumMs: number) {
  return Math.min(maximumMs, Math.max(0, Date.parse(deadlineAt) - Date.now()));
}

function hasExpectedBody(body: Buffer, bytes: number, sha256: string, maximumBytes: number) {
  return body.byteLength === bytes && body.byteLength <= maximumBytes &&
    createHash("sha256").update(body).digest("hex") === sha256;
}

function isDefinitiveControlResult(result: CloudRemoteControlResult) {
  return (result.status >= 200 && result.status < 300) ||
    (result.status >= 400 && result.status < 500 &&
      result.status !== 408 && result.status !== 425 && result.status !== 429);
}

/** Owns bounded request assembly, execution and durable control receipts. */
export class CloudRemoteRequestHandler<TConnection extends object> {
  private closed = false;
  private readonly shutdownGraceMs: number;
  private readonly shutdownController = new AbortController();
  private readonly activeOperations = new Set<Promise<void>>();
  private readonly pendingReads = new Map<string, PendingRemoteReadRequest>();
  private readonly pendingControls = new Map<string, PendingRemoteControlRequest>();

  constructor(private readonly options: CloudRemoteRequestHandlerOptions<TConnection>) {
    this.shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
    if (!Number.isSafeInteger(this.shutdownGraceMs) || this.shutdownGraceMs < 0) {
      throw new Error("Cloud remote request shutdown grace is invalid.");
    }
  }

  handleReadFrame(
    context: RequestContext<TConnection>,
    frame: CloudRemoteReadRequestFrame
  ) {
    if (this.closed) return;
    if (this.options.store.readActiveProfile()?.state !== "connected") return;

    if (frame.type === "remote.read.request.start") {
      const previewOperation = frame.operation === "preview.candidates";
      const authorized = previewOperation
        ? context.profile.remotePreviewEnabled && context.previewNegotiated === true
        : hasRemoteReadCapability(context, frame.operation);
      if (!authorized) {
        this.options.closeConnection(
          context.connection,
          1008,
          previewOperation
            ? "remote preview capability was not negotiated"
            : remoteReadCapabilityError(frame.operation)
        );

        return;
      }

      this.startRead(context.connection, frame);
      return;
    }

    const pending = this.pendingReads.get(frame.requestId);

    if (!pending) return;

    if (frame.type === "remote.read.request.chunk") {
      if (frame.index >= pending.chunkCount || pending.chunks[frame.index]) {
        this.rejectPendingRead(context.connection, frame.requestId, "invalid remote read chunks");
        return;
      }

      const chunk = Buffer.from(frame.data, "base64");

      if (chunk.byteLength > CLOUD_REMOTE_READ_CHUNK_BYTES) {
        this.rejectPendingRead(
          context.connection,
          frame.requestId,
          "invalid remote read chunk size"
        );

        return;
      }

      pending.chunks[frame.index] = chunk;
      return;
    }

    clearTimeout(pending.expiryTimer);
    this.pendingReads.delete(frame.requestId);
    if (frame.bodySha256 !== pending.bodySha256 || pending.chunks.some((chunk) => !chunk)) {
      this.options.closeConnection(context.connection, 1008, "incomplete remote read request");
      return;
    }

    const body = Buffer.concat(pending.chunks as Buffer[]);

    if (!hasExpectedBody(body, pending.bodyBytes, pending.bodySha256, CLOUD_REMOTE_READ_MAX_REQUEST_BYTES)) {
      this.options.closeConnection(context.connection, 1008, "invalid remote read request digest");
      return;
    }

    let input: CloudRemoteReadOperationInput;
    try {
      input = parseCloudRemoteReadOperationInput(
        pending.operation,
        JSON.parse(body.toString("utf8")) as unknown
      );
    } catch {
      this.sendReadResult(context.connection, frame.requestId, {
        status: 400,
        body: { error: "invalid_request" }
      });
      return;
    }

    if (pending.operation === "assets.file.read" &&
        !hasRemoteReadCapability(context, pending.operation, input)) {
      this.options.closeConnection(
        context.connection,
        1008,
        remoteReadCapabilityError(pending.operation, input)
      );

      return;
    }

    if (Date.parse(pending.deadlineAt) <= Date.now()) {
      this.sendReadResult(context.connection, frame.requestId, {
        status: 504,
        body: { error: "remote_read_expired" }
      });
      return;
    }

    this.trackOperation(
      this.options.readExecutor.execute(
        pending.operation,
        input,
        this.shutdownController.signal
      ).then((result) => {
        if (this.closed) return;

        if (this.options.isCurrentConnection(context.connection, context.profile.id)) {
          this.sendReadResult(context.connection, frame.requestId, result);
        }
      }).catch(() => {
        if (this.closed) return;

        if (this.options.isCurrentConnection(context.connection, context.profile.id)) {
          this.sendReadResult(context.connection, frame.requestId, {
            status: 500,
            body: { error: "remote_read_failed" }
          });
        }
      })
    );
  }

  handleControlFrame(
    context: RequestContext<TConnection>,
    frame: RemoteControlRequestFrame
  ) {
    if (this.closed) return;

    if (!context.profile.remoteControlEnabled || !context.negotiated) {
      this.options.closeConnection(
        context.connection,
        1008,
        "remote control capability was not negotiated"
      );

      return;
    }

    if (frame.type === "remote.control.request.start" &&
        isPreviewControlOperation(frame.operation) &&
        (!context.profile.remotePreviewEnabled || context.previewNegotiated !== true)) {
      this.options.closeConnection(
        context.connection,
        1008,
        "remote preview capability was not negotiated"
      );

      return;
    }

    if (this.options.store.readActiveProfile()?.state !== "connected") return;

    if (frame.type === "remote.control.request.start") {
      this.startControl(context.connection, frame);
      return;
    }

    const pending = this.pendingControls.get(frame.requestId);

    if (!pending) return;

    if (frame.type === "remote.control.request.chunk") {
      if (frame.index >= pending.chunkCount || pending.chunks[frame.index]) {
        this.rejectPendingControl(
          context.connection,
          frame.requestId,
          "invalid remote control chunks"
        );

        return;
      }

      const chunk = Buffer.from(frame.data, "base64");

      if (chunk.byteLength > REMOTE_CONTROL_CHUNK_BYTES) {
        this.rejectPendingControl(
          context.connection,
          frame.requestId,
          "invalid remote control chunk size"
        );

        return;
      }

      pending.chunks[frame.index] = chunk;
      return;
    }

    clearTimeout(pending.expiryTimer);
    this.pendingControls.delete(frame.requestId);
    if (frame.bodySha256 !== pending.bodySha256 || pending.chunks.some((chunk) => !chunk)) {
      this.options.closeConnection(context.connection, 1008, "incomplete remote control request");
      return;
    }

    const body = Buffer.concat(pending.chunks as Buffer[]);

    if (!hasExpectedBody(body, pending.bodyBytes, pending.bodySha256, REMOTE_CONTROL_MAX_REQUEST_BYTES)) {
      this.options.closeConnection(context.connection, 1008, "invalid remote control request digest");
      return;
    }

    let input: Record<string, unknown>;
    try {
      input = parseRemoteControlOperationInput(
        pending.operation,
        JSON.parse(body.toString("utf8")) as unknown
      );
    } catch {
      this.sendControlResult(context.connection, frame.requestId, {
        status: 400,
        body: { error: "invalid_remote_control_request" }
      });
      return;
    }

    if (Date.parse(pending.deadlineAt) <= Date.now()) {
      this.sendControlResult(context.connection, frame.requestId, {
        status: 504,
        body: { error: "remote_control_expired" }
      });
      return;
    }

    const inputSha256 = createHash("sha256")
      .update(`${pending.operation}\n${canonicalCloudJson(input)}`)
      .digest("hex");
    let reservation: ReturnType<SqliteCloudConnectorStore["reserveControlCommand"]>;
    try {
      reservation = this.options.store.reserveControlCommand({
        profileId: context.profile.id,
        commandId: pending.commandId,
        operation: pending.operation,
        inputSha256
      });
    } catch {
      this.sendControlResult(context.connection, frame.requestId, {
        status: 503,
        body: { error: "remote_control_receipt_capacity" }
      });
      return;
    }

    if (reservation.kind === "conflict") {
      this.sendControlResult(context.connection, frame.requestId, {
        status: 409,
        body: { error: "remote_control_command_conflict" }
      });
      return;
    }

    if (reservation.kind === "ambiguous") {
      this.sendControlResult(context.connection, frame.requestId, {
        status: 409,
        body: { error: "remote_control_outcome_unknown" }
      });
      return;
    }

    if (reservation.kind === "replay") {
      this.sendControlResult(context.connection, frame.requestId, {
        status: reservation.status,
        body: reservation.body
      });
      return;
    }

    this.trackOperation(
      this.options.controlExecutor.execute(
        pending.operation,
        input,
        this.shutdownController.signal
      ).then((result) => {
        if (this.closed) return;

        if (!isDefinitiveControlResult(result)) {
          // Once the loopback request has been dispatched, a timeout or server
          // failure cannot prove that the local side effect did not happen.
          // Keep the durable reservation pending so the same command id can
          // never execute twice, and expose the ambiguity explicitly.
          if (this.options.isCurrentConnection(context.connection, context.profile.id)) {
            this.sendControlResult(context.connection, frame.requestId, {
              status: 409,
              body: { error: "remote_control_outcome_unknown" }
            });
          }

          return;
        }

        this.options.store.completeControlCommand({
          profileId: context.profile.id,
          commandId: pending.commandId,
          status: result.status,
          body: createCloudControlReceiptBody(result)
        });
        if (this.options.isCurrentConnection(context.connection, context.profile.id)) {
          this.sendControlResult(context.connection, frame.requestId, result);
        }
      }).catch(() => {
        // A durable pending receipt deliberately remains ambiguous. Retrying an
        // input after an unknown local outcome could execute it twice.
        if (this.closed) return;

        if (this.options.isCurrentConnection(context.connection, context.profile.id)) {
          this.sendControlResult(context.connection, frame.requestId, {
            status: 409,
            body: { error: "remote_control_outcome_unknown" }
          });
        }
      })
    );
  }

  clearPending() {
    for (const pending of this.pendingReads.values()) clearTimeout(pending.expiryTimer);
    for (const pending of this.pendingControls.values()) clearTimeout(pending.expiryTimer);
    this.pendingReads.clear();
    this.pendingControls.clear();
  }

  async close() {
    if (this.closed) return;

    this.closed = true;
    this.clearPending();
    this.shutdownController.abort();
    const operations = [...this.activeOperations];

    if (operations.length === 0) return;

    let graceTimer: NodeJS.Timeout | undefined;
    const graceElapsed = new Promise<void>((resolve) => {
      graceTimer = setTimeout(resolve, this.shutdownGraceMs);
    });

    await Promise.race([Promise.allSettled(operations), graceElapsed]);
    if (graceTimer) clearTimeout(graceTimer);
  }

  private startRead(
    connection: TConnection,
    frame: Extract<CloudRemoteReadRequestFrame, { type: "remote.read.request.start" }>
  ) {
    if (this.pendingReads.size >= CLOUD_REMOTE_READ_MAX_IN_FLIGHT ||
        this.pendingReads.has(frame.requestId)) {
      this.options.closeConnection(connection, 1008, "remote read capacity exceeded");
      return;
    }

    const expiryTimer = setTimeout(() => {
      if (!this.pendingReads.delete(frame.requestId)) return;

      this.sendReadResult(connection, frame.requestId, {
        status: 504,
        body: { error: "remote_read_expired" }
      });
    }, boundedDeadline(frame.deadlineAt, CLOUD_REMOTE_READ_MAX_PENDING_MS));

    expiryTimer.unref?.();
    this.pendingReads.set(frame.requestId, {
      operation: frame.operation,
      bodyBytes: frame.bodyBytes,
      chunkCount: frame.chunkCount,
      bodySha256: frame.bodySha256,
      deadlineAt: frame.deadlineAt,
      chunks: new Array<Buffer | undefined>(frame.chunkCount),
      expiryTimer
    });
  }

  private startControl(
    connection: TConnection,
    frame: Extract<RemoteControlRequestFrame, { type: "remote.control.request.start" }>
  ) {
    if (this.pendingControls.size >= CLOUD_REMOTE_CONTROL_MAX_IN_FLIGHT ||
        this.pendingControls.has(frame.requestId)) {
      this.options.closeConnection(connection, 1008, "remote control capacity exceeded");
      return;
    }

    const expiryTimer = setTimeout(() => {
      if (!this.pendingControls.delete(frame.requestId)) return;

      this.sendControlResult(connection, frame.requestId, {
        status: 504,
        body: { error: "remote_control_expired" }
      });
    }, boundedDeadline(frame.deadlineAt, CLOUD_REMOTE_CONTROL_MAX_PENDING_MS));

    expiryTimer.unref?.();
    this.pendingControls.set(frame.requestId, {
      operation: frame.operation,
      commandId: frame.commandId,
      bodyBytes: frame.bodyBytes,
      chunkCount: frame.chunkCount,
      bodySha256: frame.bodySha256,
      deadlineAt: frame.deadlineAt,
      chunks: new Array<Buffer | undefined>(frame.chunkCount),
      expiryTimer
    });
  }

  private rejectPendingRead(connection: TConnection, requestId: string, reason: string) {
    const pending = this.pendingReads.get(requestId);

    if (pending) clearTimeout(pending.expiryTimer);

    this.pendingReads.delete(requestId);
    this.options.closeConnection(connection, 1008, reason);
  }

  private rejectPendingControl(connection: TConnection, requestId: string, reason: string) {
    const pending = this.pendingControls.get(requestId);

    if (pending) clearTimeout(pending.expiryTimer);

    this.pendingControls.delete(requestId);
    this.options.closeConnection(connection, 1008, reason);
  }

  private sendReadResult(
    connection: TConnection,
    requestId: string,
    result: CloudRemoteReadResult
  ) {
    this.sendFrames(connection, createRemoteReadResponseFrames(requestId, result, {
      start: new Date().toISOString(),
      end: new Date().toISOString()
    }));
  }

  private sendControlResult(
    connection: TConnection,
    requestId: string,
    result: CloudRemoteControlResult
  ) {
    this.sendFrames(connection, createRemoteControlResponseFrames(requestId, result, {
      start: new Date().toISOString(),
      end: new Date().toISOString()
    }));
  }

  private sendFrames(connection: TConnection, frames: CloudRelayClientFrame[]) {
    for (const frame of frames) {
      if (!this.options.sendCloudFrame(connection, frame)) return;
    }
  }

  private trackOperation(operation: Promise<void>) {
    this.activeOperations.add(operation);
    void operation.then(
      () => this.activeOperations.delete(operation),
      () => this.activeOperations.delete(operation)
    );
  }
}
