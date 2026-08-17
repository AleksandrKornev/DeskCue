import {
  opendir,
  mkdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TranscriptPart } from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";

import { isRecord } from "../codexTranscriptShared.ts";

type ImageWriteTask = {
  base64: string;
  outputPath: string;
};

const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_IMAGE_WRITES = 4;
const MAX_CONCURRENT_IMAGE_WRITES = 2;
const GENERATED_IMAGE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;
const GENERATED_IMAGE_SESSION_FILE_LIMIT = 32;
const GENERATED_IMAGE_SESSION_BYTE_LIMIT = 64 * 1024 * 1024;
const GENERATED_IMAGE_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

const SUPPORTED_DATA_IMAGE_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/bmp", "bmp"],
  ["image/svg+xml", "svg"]
]);

const pendingPaths = new Set<string>();
const knownPaths = new Set<string>();
const writeQueue: ImageWriteTask[] = [];
const idleWaiters = new Set<() => void>();
let activeWrites = 0;
let lastCleanupAt = 0;

export function waitForGeneratedImageWritesForTests() {
  if (activeWrites === 0 && writeQueue.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => idleWaiters.add(resolve));
}

export async function waitForPendingGeneratedImage(filePath: string) {
  if (pendingPaths.has(filePath)) await waitForGeneratedImageWritesForTests();
}

async function removeGeneratedImage(filePath: string) {
  knownPaths.delete(filePath);
  await rm(filePath, { force: true });
}

async function cleanupGeneratedImageSession(directoryPath: string) {
  const retained: Array<{ filePath: string; mtimeMs: number; size: number }> = [];
  let directory;
  try {
    directory = await opendir(directoryPath);
  } catch {
    return;
  }

  for await (const entry of directory) {
    if (!entry.isFile() || entry.name.endsWith(".tmp")) continue;
    const filePath = path.join(directoryPath, entry.name);
    try {
      const fileStats = await stat(filePath);
      if (Date.now() - fileStats.mtimeMs > GENERATED_IMAGE_MAX_AGE_MS) {
        await removeGeneratedImage(filePath);
        continue;
      }
      retained.push({ filePath, mtimeMs: fileStats.mtimeMs, size: fileStats.size });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  retained.sort((left, right) => right.mtimeMs - left.mtimeMs);
  let retainedBytes = 0;
  for (const [index, file] of retained.entries()) {
    retainedBytes += file.size;
    if (
      index >= GENERATED_IMAGE_SESSION_FILE_LIMIT ||
      retainedBytes > GENERATED_IMAGE_SESSION_BYTE_LIMIT
    ) {
      await removeGeneratedImage(file.filePath);
    }
  }
}

async function cleanupGeneratedImageRoot(rootPath: string) {
  let root;
  try {
    root = await opendir(rootPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return;
  }

  for await (const entry of root) {
    if (!entry.isDirectory()) continue;
    await cleanupGeneratedImageSession(path.join(rootPath, entry.name));
  }
}

function resolveIdleWaitersIfNeeded() {
  if (activeWrites > 0 || writeQueue.length > 0) return;
  for (const resolve of idleWaiters) resolve();
  idleWaiters.clear();
}

function estimateDecodedBytes(base64: string) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function toSafePathSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "unknown";
}

function getGeneratedTranscriptImageRoot() {
  return path.join(
    process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    "generated_images",
    "deskcue-transcript-assets"
  );
}

async function materializeDataImage({ base64, outputPath }: ImageWriteTask) {
  try {
    const existing = await stat(outputPath);
    if (existing.isFile()) {
      knownPaths.add(outputPath);
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_INLINE_IMAGE_BYTES) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, buffer);
    await rename(temporaryPath, outputPath);
    knownPaths.add(outputPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }

  await cleanupGeneratedImageSession(path.dirname(outputPath));

  if (Date.now() - lastCleanupAt >= GENERATED_IMAGE_CLEANUP_INTERVAL_MS) {
    lastCleanupAt = Date.now();
    await cleanupGeneratedImageRoot(getGeneratedTranscriptImageRoot());
  }
}

function drainWriteQueue() {
  while (activeWrites < MAX_CONCURRENT_IMAGE_WRITES && writeQueue.length > 0) {
    const task = writeQueue.shift();
    if (!task) break;
    activeWrites += 1;
    void materializeDataImage(task)
      .catch((error) => {
        logger.warn("Failed to materialize Codex generated image", {
          message: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        pendingPaths.delete(task.outputPath);
        activeWrites -= 1;
        drainWriteQueue();
        resolveIdleWaitersIfNeeded();
      });
  }
}

function scheduleDataImageMaterialization(
  dataUrl: string,
  sessionId: string,
  callId: string | null,
  index: number
) {
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match?.[1] || !match[2]) return null;

  const extension = SUPPORTED_DATA_IMAGE_TYPES.get(match[1].toLowerCase());
  if (!extension) return null;
  const base64 = match[2].replace(/\s/g, "");
  if (estimateDecodedBytes(base64) > MAX_INLINE_IMAGE_BYTES) return null;

  const outputDirectory = path.join(
    getGeneratedTranscriptImageRoot(),
    toSafePathSegment(sessionId)
  );
  const outputPath = path.join(
    outputDirectory,
    `${toSafePathSegment(callId || "image-output")}-${index + 1}.${extension}`
  );
  if (knownPaths.has(outputPath) || pendingPaths.has(outputPath)) return outputPath;
  if (writeQueue.length + activeWrites >= MAX_PENDING_IMAGE_WRITES) return null;

  pendingPaths.add(outputPath);
  writeQueue.push({ base64, outputPath });
  drainWriteQueue();
  return outputPath;
}

export function buildGeneratedImageToolResultParts(
  output: unknown,
  sessionId: string,
  callId: string | null
): TranscriptPart[] {
  if (!Array.isArray(output)) return [];

  const attachments: TranscriptPart[] = [];
  output.forEach((item, index) => {
    const imageUrl = isRecord(item) && item.type === "input_image" && typeof item.image_url === "string"
      ? item.image_url
      : null;
    const imagePath = imageUrl
      ? scheduleDataImageMaterialization(imageUrl, sessionId, callId, index)
      : null;
    if (!imagePath) return;

    attachments.push({
      type: "attachment",
      kind: "local-image",
      label: attachments.length === 0
        ? "Generated image"
        : `Generated image ${attachments.length + 1}`,
      url: null,
      path: imagePath
    });
  });
  return attachments;
}
