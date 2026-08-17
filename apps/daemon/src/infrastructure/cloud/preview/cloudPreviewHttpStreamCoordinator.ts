import { createHash } from "node:crypto";

import {
  CLOUD_PREVIEW_CHUNK_BYTES,
  CLOUD_PREVIEW_HTTP_MAX_REQUEST_BYTES,
  CLOUD_PREVIEW_HTTP_MAX_RESPONSE_BYTES,
  CLOUD_PREVIEW_MAX_CREDIT_BYTES,
  CLOUD_PREVIEW_MAX_HTTP_STREAMS,
  CLOUD_PREVIEW_PROTOCOL_VERSION
} from "@deskcue/protocol/cloud";
import type {
  CloudPreviewClientFrame,
  CloudPreviewHeader,
  CloudPreviewServerFrame
} from "@deskcue/protocol/cloud";

import {
  CloudPreviewRequestPolicy,
  CloudPreviewRequestRejectedError
} from "./cloudPreviewRequestPolicy.ts";
import type { AuthorizedCloudPreviewRequest } from "./cloudPreviewRequestPolicy.ts";

const INITIAL_CREDIT_BYTES = 64 * 1024;
const MAX_STREAM_LIFETIME_MS = 30_000;
const DEFAULT_HTTP_RESPONSE_IDLE_TIMEOUT_MS = 30_000;

export type CloudPreviewHttpResult = {
  body: AsyncIterable<Buffer>;
  cancel(): Promise<void> | void;
  contentLength: number | null;
  headers: CloudPreviewHeader[];
  status: number;
};

type CloudPreviewHttpStreamCoordinatorOptions = {
  executeHttp(request: AuthorizedCloudPreviewRequest & {
    body: AsyncIterable<Buffer>;
    contentLength: number | null;
    signal: AbortSignal;
  }): Promise<CloudPreviewHttpResult>;
  isActiveEpoch(epoch: number): boolean;
  policy: CloudPreviewRequestPolicy;
  responseIdleTimeoutMs?: number;
  sendFrame(frame: CloudPreviewClientFrame): boolean;
};

type HttpStream = {
  bytes: number;
  contentLength: number | null;
  controller: AbortController;
  deadline: NodeJS.Timeout;
  digest: ReturnType<typeof createHash>;
  epoch: number;
  nextSequence: number;
  requestBody: PreviewRequestBodyQueue;
  requestCredit: number;
  resultPromise: Promise<CloudPreviewHttpResult>;
  responseCredit: number;
  response?: {
    body: AsyncIterator<Buffer>;
    bytes: number;
    cancel: () => Promise<void> | void;
    contentLength: number | null;
    digest: ReturnType<typeof createHash>;
    done: boolean;
    offset: number;
    pending: Buffer | null;
    pumping: boolean;
    sequence: number;
  };
};

type CloudPreviewHttpErrorCode = Extract<
  CloudPreviewClientFrame,
  { type: "preview.http.response.error" }
>["code"];

function now() {
  return new Date().toISOString();
}

function settlePreviewCleanup(cleanup: () => unknown) {
  try {
    void Promise.resolve(cleanup()).catch(() => {
      // Upstream cleanup errors remain inside the Preview boundary.
    });
  } catch {
    // Synchronous cleanup errors remain inside the Preview boundary.
  }
}

function abortError() {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

class PreviewRequestBodyQueue implements AsyncIterable<Buffer>, AsyncIterator<Buffer> {
  private readonly chunks: Array<{ body: Buffer; consumed: () => void }> = [];
  private readonly waiters: Array<{
    reject: (error: unknown) => void;
    resolve: (result: IteratorResult<Buffer>) => void;
  }> = [];
  private ended = false;
  private failure: Error | null = null;

  [Symbol.asyncIterator]() { return this; }

  next(): Promise<IteratorResult<Buffer>> {
    const chunk = this.chunks.shift();
    if (chunk) {
      chunk.consumed();
      return Promise.resolve({ done: false, value: chunk.body });
    }
    if (this.failure) return Promise.reject(this.failure);
    if (this.ended) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.waiters.push({ reject, resolve }));
  }

  return(): Promise<IteratorResult<Buffer>> {
    this.end();
    return Promise.resolve({ done: true, value: undefined });
  }

  push(body: Buffer, consumed: () => void) {
    if (this.ended || this.failure) return false;
    const waiter = this.waiters.shift();
    if (waiter) {
      consumed();
      waiter.resolve({ done: false, value: body });
    } else {
      this.chunks.push({ body, consumed });
    }
    return true;
  }

  end() {
    if (this.ended || this.failure) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    this.chunks.length = 0;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
}

export class CloudPreviewHttpStreamCoordinator {
  private readonly streams = new Map<string, HttpStream>();
  private readonly starting = new Set<string>();

  constructor(private readonly options: CloudPreviewHttpStreamCoordinatorOptions) {}

  async start(
    frame: Extract<CloudPreviewServerFrame, { type: "preview.http.request.start" }>,
    epoch: number
  ) {
    if (this.streams.size + this.starting.size >= CLOUD_PREVIEW_MAX_HTTP_STREAMS ||
        this.streams.has(frame.streamId) || this.starting.has(frame.streamId)) {
      return this.sendError(frame.streamId, "invalid_request", false);
    }
    this.starting.add(frame.streamId);
    try {
      const request = await this.options.policy.authorize({
        headers: frame.headers,
        method: frame.method,
        owner: { id: frame.owner.ownerId, kind: frame.owner.kind },
        pathAndQuery: frame.path,
        transport: "http",
        viewerId: frame.viewerId
      });
      if (!this.options.isActiveEpoch(epoch)) return false;
      const controller = new AbortController();
      const deadline = this.createDeadline(frame.streamId, frame.deadlineAt);
      const stream: HttpStream = {
        bytes: 0,
        contentLength: frame.contentLength,
        controller,
        deadline,
        digest: createHash("sha256"),
        epoch,
        nextSequence: 0,
        requestBody: new PreviewRequestBodyQueue(),
        requestCredit: INITIAL_CREDIT_BYTES,
        resultPromise: Promise.resolve(null as never),
        responseCredit: 0
      };
      this.streams.set(frame.streamId, stream);
      stream.resultPromise = this.options.executeHttp({
        ...request,
        body: stream.requestBody,
        contentLength: frame.contentLength,
        signal: controller.signal
      });
      void stream.resultPromise.catch(() => {
        // finish owns the observable protocol error; this prevents an early
        // upstream rejection from becoming an unhandled promise.
      });
      return this.sendCredit(frame.streamId, INITIAL_CREDIT_BYTES);
    } catch (error) {
      return this.sendError(
        frame.streamId,
        error instanceof CloudPreviewRequestRejectedError ? error.code : "preview_unavailable",
        error instanceof CloudPreviewRequestRejectedError && error.code === "preview_unavailable"
      );
    } finally {
      this.starting.delete(frame.streamId);
    }
  }

  acceptChunk(
    frame: Extract<CloudPreviewServerFrame, { type: "preview.http.request.chunk" }>
  ) {
    const stream = this.streams.get(frame.streamId);
    if (!stream) return false;
    const chunk = Buffer.from(frame.data, "base64");
    if (frame.sequence !== stream.nextSequence || chunk.byteLength > stream.requestCredit ||
        stream.bytes + chunk.byteLength > CLOUD_PREVIEW_HTTP_MAX_REQUEST_BYTES ||
        (stream.contentLength !== null && stream.bytes + chunk.byteLength > stream.contentLength)) {
      return this.fail(frame.streamId, "invalid_request", false);
    }
    stream.bytes += chunk.byteLength;
    stream.digest.update(chunk);
    stream.nextSequence += 1;
    stream.requestCredit -= chunk.byteLength;
    this.armIdleDeadline(frame.streamId, stream);
    stream.requestBody.push(chunk, () => {
      if (this.streams.get(frame.streamId) !== stream) return;
      this.armIdleDeadline(frame.streamId, stream);
      stream.requestCredit += chunk.byteLength;
      this.sendCredit(frame.streamId, chunk.byteLength);
    });
    return true;
  }

  async finish(
    frame: Extract<CloudPreviewServerFrame, { type: "preview.http.request.end" }>
  ) {
    const stream = this.streams.get(frame.streamId);
    if (!stream) return false;
    if (frame.chunkCount !== stream.nextSequence || frame.bodyBytes !== stream.bytes ||
        (stream.contentLength !== null && stream.contentLength !== stream.bytes)) {
      return this.fail(frame.streamId, "invalid_request", false);
    }
    if (stream.digest.digest("hex") !== frame.bodySha256) return this.fail(frame.streamId, "invalid_request", false);
    stream.requestBody.end();
    this.armIdleDeadline(frame.streamId, stream);
    try {
      const result = await stream.resultPromise;
      if (this.streams.get(frame.streamId) !== stream ||
          !this.options.isActiveEpoch(stream.epoch)) return false;
      if (result.contentLength !== null &&
          (!Number.isSafeInteger(result.contentLength) || result.contentLength < 0 ||
           result.contentLength > CLOUD_PREVIEW_HTTP_MAX_RESPONSE_BYTES)) {
        return this.fail(frame.streamId, "upstream_failed", false);
      }
      clearTimeout(stream.deadline);
      stream.response = {
        body: result.body[Symbol.asyncIterator](),
        bytes: 0,
        cancel: result.cancel,
        contentLength: result.contentLength,
        digest: createHash("sha256"),
        done: result.contentLength === 0,
        offset: 0,
        pending: null,
        pumping: false,
        sequence: 0
      };
      if (!this.options.sendFrame({
        type: "preview.http.response.start",
        protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
        streamId: frame.streamId,
        status: result.status,
        headers: result.headers,
        contentLength: result.contentLength,
        sentAt: now()
      })) {
        this.delete(frame.streamId);
        return false;
      }
      return this.pumpResponse(frame.streamId, stream);
    } catch {
      if (stream.controller.signal.aborted) return false;
      return this.fail(frame.streamId, "upstream_failed", true);
    }
  }

  async addResponseCredit(streamId: string, creditBytes: number) {
    const stream = this.streams.get(streamId);
    if (!stream || stream.responseCredit + creditBytes > CLOUD_PREVIEW_MAX_CREDIT_BYTES) {
      return stream ? this.fail(streamId, "invalid_request", false) : false;
    }
    stream.responseCredit += creditBytes;
    return this.pumpResponse(streamId, stream);
  }

  cancel(streamId: string) {
    if (!this.streams.has(streamId)) return false;
    this.delete(streamId);
    return true;
  }

  abortAll() {
    for (const streamId of [...this.streams.keys()]) this.delete(streamId);
  }

  private async pumpResponse(streamId: string, stream: HttpStream): Promise<boolean> {
    const response = stream.response;
    if (!response) return true;
    if (response.pumping) return true;
    response.pumping = true;
    try {
      while (this.streams.get(streamId) === stream && this.options.isActiveEpoch(stream.epoch)) {
        if (response.pending && response.offset < response.pending.byteLength) {
          if (stream.responseCredit === 0) return true;
          const bytes = Math.min(
            CLOUD_PREVIEW_CHUNK_BYTES,
            stream.responseCredit,
            response.pending.byteLength - response.offset
          );
          const chunk = response.pending.subarray(response.offset, response.offset + bytes);
          if (!this.options.sendFrame({
            type: "preview.http.response.chunk",
            protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
            streamId,
            sequence: response.sequence,
            data: chunk.toString("base64")
          })) return this.cancel(streamId);
          response.digest.update(chunk);
          response.bytes += bytes;
          response.offset += bytes;
          response.sequence += 1;
          stream.responseCredit -= bytes;
          if (response.offset === response.pending.byteLength) {
            response.pending = null;
            response.offset = 0;
            if (response.contentLength !== null && response.bytes === response.contentLength) response.done = true;
          }
          continue;
        }
        if (response.done) {
          if (response.contentLength !== null && response.contentLength !== response.bytes) {
            return this.fail(streamId, "upstream_failed", false);
          }
          const ended = this.options.sendFrame({
            type: "preview.http.response.end",
            protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
            streamId,
            bodyBytes: response.bytes,
            chunkCount: response.sequence,
            bodySha256: response.digest.digest("hex"),
            sentAt: now()
          });
          this.delete(streamId);
          return ended;
        }
        // Do not pull from the upstream stream until Cloud has granted room
        // for at least part of the next chunk.
        if (stream.responseCredit === 0) return true;
        this.armIdleDeadline(streamId, stream);
        const next = await response.body.next();
        clearTimeout(stream.deadline);
        if (this.streams.get(streamId) !== stream ||
            !this.options.isActiveEpoch(stream.epoch)) return false;
        if (next.done) {
          response.done = true;
          continue;
        }
        const chunk = Buffer.from(next.value);
        if (chunk.byteLength === 0) continue;
        if (response.bytes + chunk.byteLength > CLOUD_PREVIEW_HTTP_MAX_RESPONSE_BYTES ||
            (response.contentLength !== null &&
             response.bytes + chunk.byteLength > response.contentLength)) {
          return this.fail(streamId, "upstream_failed", false);
        }
        response.pending = chunk;
        response.offset = 0;
      }
      return false;
    } catch {
      if (stream.controller.signal.aborted || this.streams.get(streamId) !== stream) return false;
      return this.fail(streamId, "upstream_failed", true);
    } finally {
      response.pumping = false;
    }
  }

  private fail(streamId: string, code: CloudPreviewHttpErrorCode, retryable: boolean) {
    this.delete(streamId);
    return this.sendError(streamId, code, retryable);
  }

  private sendCredit(streamId: string, creditBytes: number) {
    return this.options.sendFrame({
      type: "preview.flow.credit",
      protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
      streamId,
      direction: "http.request",
      creditBytes,
      sentAt: now()
    });
  }

  private sendError(streamId: string, code: CloudPreviewHttpErrorCode, retryable: boolean) {
    return this.options.sendFrame({
      type: "preview.http.response.error",
      protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
      streamId,
      code,
      retryable,
      sentAt: now()
    });
  }

  private createDeadline(streamId: string, deadlineAt: string) {
    const timeout = setTimeout(() => {
      this.fail(streamId, "deadline_exceeded", true);
    }, Math.min(MAX_STREAM_LIFETIME_MS, Math.max(0, Date.parse(deadlineAt) - Date.now())));
    timeout.unref?.();
    return timeout;
  }

  private armIdleDeadline(streamId: string, stream: HttpStream) {
    clearTimeout(stream.deadline);
    stream.deadline = setTimeout(() => {
      if (this.streams.get(streamId) === stream) this.fail(streamId, "deadline_exceeded", true);
    }, this.options.responseIdleTimeoutMs ?? DEFAULT_HTTP_RESPONSE_IDLE_TIMEOUT_MS);
    stream.deadline.unref?.();
  }

  private delete(streamId: string) {
    const stream = this.streams.get(streamId);
    if (!stream) return;
    this.streams.delete(streamId);
    clearTimeout(stream.deadline);
    stream.controller.abort();
    stream.requestBody.fail(abortError());
    const response = stream.response;
    if (response) {
      settlePreviewCleanup(() => response.cancel());
    }
    const body = response?.body;
    if (body?.return) {
      settlePreviewCleanup(() => body.return!());
    }
  }
}
