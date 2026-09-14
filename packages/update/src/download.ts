import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { UpdateError } from "./errors.ts";
import type { UpdateArtifact } from "./manifest.ts";
import { fetchUpdateResponse } from "./sourcePolicy.ts";
import type { UpdateRequestPolicy } from "./sourcePolicy.ts";

export const DEFAULT_UPDATE_ARTIFACT_MAX_BYTES = 512 * 1024 * 1024;
export const DEFAULT_UPDATE_MANIFEST_MAX_BYTES = 256 * 1024;
export const DEFAULT_UPDATE_STREAM_INACTIVITY_TIMEOUT_MS = 30_000;

export type UpdateDownloadProgress = {
  receivedBytes: number;
  totalBytes: number;
};

export type DownloadUpdateArtifactOptions = UpdateRequestPolicy & {
  artifact: UpdateArtifact;
  destinationPath: string;
  inactivityTimeoutMs?: number;
  maxBytes?: number;
  onProgress?: (progress: UpdateDownloadProgress) => void;
};

function parseContentLength(value: string | null) {
  if (value === null) return null;

  if (!/^\d+$/.test(value)) {
    throw new UpdateError("artifact_size_mismatch", "Update response Content-Length is invalid.");
  }

  const length = Number(value);

  if (!Number.isSafeInteger(length)) {
    throw new UpdateError("artifact_size_mismatch", "Update response Content-Length is too large.");
  }

  return length;
}

function assertDownloadLimit(expectedBytes: number, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("Update download maximum size must be a positive integer.");
  }

  if (expectedBytes > maxBytes) {
    throw new UpdateError(
      "artifact_size_mismatch",
      `Update artifact declares ${expectedBytes} bytes, exceeding the ${maxBytes} byte limit.`
    );
  }
}

function translateStreamError(
  error: unknown,
  signal: AbortSignal | undefined,
  timedOut: () => boolean
) {
  if (timedOut()) return new UpdateError("timeout", "Update request timed out.", { cause: error });
  if (signal?.aborted) return new UpdateError("cancelled", "Update download was cancelled.", { cause: error });
  if (error instanceof UpdateError) return error;

  return new UpdateError("download_failed", "Update download failed.", { cause: error });
}

async function writeAll(file: Awaited<ReturnType<typeof open>>, bytes: Uint8Array) {
  let offset = 0;

  while (offset < bytes.byteLength) {
    const result = await file.write(bytes, offset, bytes.byteLength - offset);

    if (result.bytesWritten <= 0) {
      throw new UpdateError("download_failed", "Update artifact could not be written to staging storage.");
    }

    offset += result.bytesWritten;
  }
}

export async function readBoundedUpdateResponse(
  url: string,
  options: UpdateRequestPolicy & { inactivityTimeoutMs?: number; maxBytes: number }
) {
  const request = await fetchUpdateResponse(url, options);
  const reader = request.response.body?.getReader();

  if (!reader) {
    request.dispose();
    throw new UpdateError("download_failed", "Update response did not contain a body.");
  }

  request.startInactivityTimeout(
    options.inactivityTimeoutMs ?? DEFAULT_UPDATE_STREAM_INACTIVITY_TIMEOUT_MS
  );

  const contentLength = parseContentLength(request.response.headers.get("content-length"));

  if (contentLength !== null && contentLength > options.maxBytes) {
    await reader.cancel();
    request.dispose();
    throw new UpdateError("artifact_size_mismatch", "Update response exceeds the configured size limit.");
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const next = await reader.read();

      if (next.done) break;
      if (!next.value) continue;

      request.touchTimeout();

      receivedBytes += next.value.byteLength;
      if (receivedBytes > options.maxBytes) {
        await reader.cancel();
        throw new UpdateError("artifact_size_mismatch", "Update response exceeds the configured size limit.");
      }

      chunks.push(next.value);
    }
  } catch (error) {
    throw translateStreamError(error, options.signal, request.timedOut);
  } finally {
    request.dispose();
  }

  const output = new Uint8Array(receivedBytes);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

export async function downloadUpdateArtifact({
  artifact,
  destinationPath,
  inactivityTimeoutMs = DEFAULT_UPDATE_STREAM_INACTIVITY_TIMEOUT_MS,
  maxBytes = DEFAULT_UPDATE_ARTIFACT_MAX_BYTES,
  onProgress,
  ...requestPolicy
}: DownloadUpdateArtifactOptions) {
  assertDownloadLimit(artifact.sizeBytes, maxBytes);

  const partialPath = `${destinationPath}.part`;

  await mkdir(dirname(destinationPath), { recursive: true });

  await rm(partialPath, { force: true });
  if (existsSync(destinationPath)) {
    throw new UpdateError("download_failed", `Staged update artifact already exists: ${destinationPath}.`);
  }

  const request = await fetchUpdateResponse(artifact.url, requestPolicy);
  const reader = request.response.body?.getReader();

  if (!reader) {
    request.dispose();
    throw new UpdateError("download_failed", "Update artifact response did not contain a body.");
  }

  request.startInactivityTimeout(inactivityTimeoutMs);

  const contentLength = parseContentLength(request.response.headers.get("content-length"));

  if (contentLength !== null && contentLength !== artifact.sizeBytes) {
    await reader.cancel();
    request.dispose();
    throw new UpdateError(
      "artifact_size_mismatch",
      `Update artifact Content-Length ${contentLength} does not match ${artifact.sizeBytes}.`
    );
  }

  const hash = createHash("sha256");
  let file: Awaited<ReturnType<typeof open>> | null = null;
  let ownsPartialFile = false;
  let receivedBytes = 0;

  try {
    file = await open(partialPath, "wx");
    ownsPartialFile = true;

    while (true) {
      const next = await reader.read();

      if (next.done) break;
      if (!next.value) continue;

      request.touchTimeout();

      receivedBytes += next.value.byteLength;
      if (receivedBytes > artifact.sizeBytes || receivedBytes > maxBytes) {
        throw new UpdateError("artifact_size_mismatch", "Update artifact exceeded its declared size.");
      }

      await writeAll(file, next.value);
      hash.update(next.value);
      onProgress?.({
        receivedBytes,
        totalBytes: artifact.sizeBytes
      });
    }

    if (receivedBytes !== artifact.sizeBytes) {
      throw new UpdateError(
        "artifact_size_mismatch",
        `Update artifact ended after ${receivedBytes} of ${artifact.sizeBytes} bytes.`
      );
    }

    const actualHash = hash.digest("hex");

    if (actualHash !== artifact.sha256) {
      throw new UpdateError("artifact_hash_mismatch", "Update artifact SHA-256 does not match its manifest.");
    }

    await file.sync();
    await file.close();
    file = null;
    await rename(partialPath, destinationPath);

    return {
      path: destinationPath,
      receivedBytes,
      sha256: actualHash
    };
  } catch (error) {
    await reader.cancel().catch(() => {});
    await file?.close().catch(() => {});
    if (ownsPartialFile) await rm(partialPath, { force: true }).catch(() => {});
    throw translateStreamError(error, requestPolicy.signal, request.timedOut);
  } finally {
    request.dispose();
  }
}
