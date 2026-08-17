import type express from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import { logger } from "#infrastructure/logging/logger";

const JSON_GZIP_THRESHOLD_BYTES = 4 * 1024;

export type HttpCompressionMode = "auto" | "off";

export type JsonResponseOptions = {
  httpCompression: HttpCompressionMode;
};

function readErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function isResponseWritableDestroyed(response: express.Response) {
  return (response as express.Response & { writableDestroyed?: boolean }).writableDestroyed === true;
}

function isClientAbortedJsonResponse(response: express.Response, error: unknown) {
  if (
    response.destroyed ||
    isResponseWritableDestroyed(response) ||
    response.req.destroyed ||
    response.req.aborted
  ) {
    return true;
  }

  const code = readErrorCode(error);
  if (code === "ECONNRESET" || code === "ERR_STREAM_PREMATURE_CLOSE") {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /closed or destroyed|premature close|aborted/i.test(message);
}

function shouldGzipJsonResponse(
  response: express.Response,
  bodyByteLength: number,
  options: JsonResponseOptions
) {
  if (options.httpCompression !== "auto") {
    return false;
  }

  if (bodyByteLength < JSON_GZIP_THRESHOLD_BYTES) {
    return false;
  }

  const acceptEncoding = response.req.headers["accept-encoding"];
  const value = Array.isArray(acceptEncoding) ? acceptEncoding.join(",") : acceptEncoding ?? "";
  return /\bgzip\b/i.test(value);
}

function appendVaryHeader(value: string | number | string[] | undefined, nextValue: string) {
  const values = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : String(value).split(",");
  const normalizedValues = values.map((item) => item.trim()).filter(Boolean);

  return normalizedValues.some((item) => item.toLowerCase() === nextValue.toLowerCase())
    ? normalizedValues.join(", ")
    : [...normalizedValues, nextValue].join(", ");
}

export async function sendJsonWithEtag(
  response: express.Response,
  payload: unknown,
  etag: string,
  options: JsonResponseOptions
) {
  const body = JSON.stringify(payload);
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("ETag", etag);

  const bodyByteLength = Buffer.byteLength(body);
  if (options.httpCompression === "auto" && bodyByteLength >= JSON_GZIP_THRESHOLD_BYTES) {
    response.setHeader("Vary", appendVaryHeader(response.getHeader("Vary"), "Accept-Encoding"));
  }

  if (shouldGzipJsonResponse(response, bodyByteLength, options)) {
    response.setHeader("Content-Encoding", "gzip");
    response.type("application/json");
    try {
      await pipeline(Readable.from([body]), createGzip(), response);
    } catch (error) {
      if (isClientAbortedJsonResponse(response, error)) {
        logger.debug("Client aborted gzipped JSON response", {
          path: response.req.path,
          requestId: typeof response.locals.requestId === "string"
            ? response.locals.requestId
            : null
        });
        return;
      }

      throw error;
    }
    return;
  }

  response.type("application/json").send(body);
}

export async function sendJsonMaybeWithEtag(
  response: express.Response,
  payload: unknown,
  etag: string | null,
  options: JsonResponseOptions
) {
  if (etag) {
    await sendJsonWithEtag(response, payload, etag, options);
    return;
  }

  response.json(payload);
}

function ifNoneMatchHeaderMatches(value: string | string[] | undefined, etag: string) {
  const rawValue = Array.isArray(value) ? value.join(",") : value;
  if (!rawValue) {
    return false;
  }

  return rawValue.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized === etag;
  });
}

export function sendNotModifiedIfMatched(
  request: express.Request,
  response: express.Response,
  etag: string
) {
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("ETag", etag);

  if (ifNoneMatchHeaderMatches(request.headers["if-none-match"], etag)) {
    response.status(304).end();
    return true;
  }

  return false;
}
