import type express from "express";
import { randomUUID } from "node:crypto";

import type { RequestMetricsResponse } from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";
import { runWithRequestContext } from "#infrastructure/logging/requestContext";

import { requestMetricsCollector } from "./requestMetricsCollector.ts";
import type { RequestMetrics } from "./requestMetricsCollector.ts";

const REQUEST_METRICS_LOCAL_KEY = "deskcueRequestMetrics";

function summarizeRequestBody(body: unknown) {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const value = body as Record<string, unknown>;
  return {
    path: typeof value.path === "string" ? value.path : undefined,
    workspaceId: typeof value.workspaceId === "string" ? value.workspaceId : undefined,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
    commandLength: typeof value.command === "string" ? value.command.length : undefined,
    port: typeof value.port === "number" || value.port === null ? value.port : undefined,
    inputLength: typeof value.input === "string" ? value.input.length : undefined
  };
}

function isSensitiveQueryKey(key: string) {
  return /^(access_token|deskcuePreviewTicket|deskcueToken|token)$/i.test(key);
}

function summarizeRequestQuery(query: express.Request["query"]) {
  const summarized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(query)) {
    summarized[key] = isSensitiveQueryKey(key) ? "[redacted]" : value;
  }

  return summarized;
}

function summarizeRequestPath(path: string) {
  return path.replace(
    /(\/__deskcue_ticket__\/)[^/]+/g,
    "$1[redacted]"
  );
}

function readRequestMetrics(response: express.Response): RequestMetrics | undefined {
  const metrics = response.locals[REQUEST_METRICS_LOCAL_KEY] as unknown;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return undefined;
  }

  return metrics as RequestMetrics;
}

function readResponseBytes(response: express.Response, countedResponseBytes: number) {
  if (countedResponseBytes > 0) {
    return countedResponseBytes;
  }

  const contentLength = response.getHeader("content-length");
  if (typeof contentLength === "number" && Number.isFinite(contentLength)) {
    return contentLength;
  }

  if (typeof contentLength === "string") {
    const parsed = Number(contentLength);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return response.statusCode === 304 ? 0 : null;
}

function countResponseChunkBytes(args: unknown[]) {
  const [chunk, encoding] = args;
  if (chunk === undefined || chunk === null) {
    return 0;
  }

  if (typeof chunk === "string") {
    return Buffer.byteLength(
      chunk,
      typeof encoding === "string" ? encoding as BufferEncoding : undefined
    );
  }

  if (chunk instanceof Uint8Array) {
    return chunk.byteLength;
  }

  return 0;
}

function attachResponseByteCounter(response: express.Response) {
  let responseBytes = 0;
  const writableResponse = response as unknown as {
    end: (...args: unknown[]) => express.Response;
    write: (...args: unknown[]) => boolean;
  };
  const originalEnd = writableResponse.end.bind(response);
  const originalWrite = writableResponse.write.bind(response);

  writableResponse.write = (...args: unknown[]) => {
    responseBytes += countResponseChunkBytes(args);
    return originalWrite(...args);
  };
  writableResponse.end = (...args: unknown[]) => {
    responseBytes += countResponseChunkBytes(args);
    return originalEnd(...args);
  };

  return () => responseBytes;
}

function getRequestId(request: express.Request) {
  const header = request.header("x-request-id")?.trim();
  return header || randomUUID();
}

export function requestLogger(request: express.Request, response: express.Response, next: express.NextFunction) {
  const startedAt = Date.now();
  const startedMemory = process.memoryUsage();
  const requestId = getRequestId(request);
  const readCountedResponseBytes = attachResponseByteCounter(response);
  response.setHeader("x-request-id", requestId);
  response.locals.requestId = requestId;

  runWithRequestContext({ requestId }, () => {
    response.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      const finishedMemory = process.memoryUsage();
      const responseBytes = readResponseBytes(response, readCountedResponseBytes());
      const metrics = readRequestMetrics(response);
      requestMetricsCollector.record({
        durationMs,
        finishedMemory,
        metrics,
        startedMemory,
        responseBytes,
        statusCode: response.statusCode
      });

      logger.info("HTTP request completed", {
        method: request.method,
        path: summarizeRequestPath(request.path),
        responseBytes,
        statusCode: response.statusCode,
        durationMs,
        query: summarizeRequestQuery(request.query),
        body: summarizeRequestBody(request.body),
        metrics
      });
    });

    next();
  });
}

export function setRequestMetrics(
  response: express.Response,
  metrics: RequestMetrics
) {
  response.locals[REQUEST_METRICS_LOCAL_KEY] = {
    ...readRequestMetrics(response),
    ...metrics
  };
}

export function readRequestMetricSnapshots(): RequestMetricsResponse {
  return requestMetricsCollector.readSnapshot();
}

export function resetRequestMetricsForTests() {
  requestMetricsCollector.reset();
}
