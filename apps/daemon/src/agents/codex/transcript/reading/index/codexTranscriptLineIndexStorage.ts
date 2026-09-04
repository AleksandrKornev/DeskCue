import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

import type {
  TranscriptCompactLineSpan,
  TranscriptLineIndexSnapshot,
  TranscriptLineOffset
} from "./codexTranscriptLineIndex.types.ts";

type PersistedSnapshot = TranscriptLineIndexSnapshot & { filePath: string };
type PersistedIndexFile = {
  snapshots: PersistedSnapshot[];
  updatedAt: string;
  version: number;
};

const INDEX_FILE_NAME = "codex-transcript-line-counts.json";
const INDEX_VERSION = 13;
const WRITE_RETRY_DELAYS_MS = [25, 75, 150, 300, 600];

function isSupportedPersistedVersion(version: unknown) {
  return version === INDEX_VERSION;
}

function normalizeLineOffsets(input: unknown, options: { emptyArray?: boolean } = {}) {
  if (!Array.isArray(input)) return undefined;

  const offsets = input.filter((value): value is TranscriptLineOffset => Boolean(
    value &&
    typeof value === "object" &&
    Number.isInteger((value as TranscriptLineOffset).lineIndex) &&
    Number.isInteger((value as TranscriptLineOffset).byteOffset) &&
    (value as TranscriptLineOffset).lineIndex >= 0 &&
    (value as TranscriptLineOffset).byteOffset >= 0
  ));

  return offsets.length > 0 || options.emptyArray === true ? offsets : undefined;
}

function normalizeCompactLineSpans(input: unknown) {
  if (!Array.isArray(input)) return undefined;

  return input.filter((value): value is TranscriptCompactLineSpan => Boolean(
    value &&
    typeof value === "object" &&
    Number.isInteger((value as TranscriptCompactLineSpan).start) &&
    Number.isInteger((value as TranscriptCompactLineSpan).end) &&
    typeof (value as TranscriptCompactLineSpan).timestamp === "string" &&
    ((value as TranscriptCompactLineSpan).kind === "changes" ||
      (value as TranscriptCompactLineSpan).kind === "details" ||
      (value as TranscriptCompactLineSpan).kind === "tools") &&
    (value as TranscriptCompactLineSpan).start >= 0 &&
    (value as TranscriptCompactLineSpan).end >= (value as TranscriptCompactLineSpan).start
  ));
}

function normalizePersistedSnapshot(input: unknown): PersistedSnapshot | null {
  if (!input || typeof input !== "object") return null;

  const snapshot = input as Record<string, unknown>;

  if (
    typeof snapshot.filePath !== "string" ||
    !Number.isFinite(snapshot.lineBreakCount) ||
    !Number.isFinite(snapshot.mtimeMs) ||
    !Number.isFinite(snapshot.size)
  ) {
    return null;
  }

  return {
    filePath: snapshot.filePath,
    chatMessageLineOffsets: normalizeLineOffsets(snapshot.chatMessageLineOffsets),
    compactLineSpans: normalizeCompactLineSpans(snapshot.compactLineSpans),
    contextCompactionCount: Number.isFinite(snapshot.contextCompactionCount)
      ? snapshot.contextCompactionCount as number
      : undefined,
    endsWithLineBreak:
      typeof snapshot.endsWithLineBreak === "boolean" ? snapshot.endsWithLineBreak : undefined,
    exactLineOffsets: normalizeLineOffsets(snapshot.exactLineOffsets, { emptyArray: true }),
    lineHintsComplete: snapshot.lineHintsComplete === true,
    lineBreakCount: snapshot.lineBreakCount as number,
    lineOffsets: normalizeLineOffsets(snapshot.lineOffsets),
    mtimeMs: snapshot.mtimeMs as number,
    size: snapshot.size as number
  };
}

function getStoragePath() {
  return join(dirname(daemonConfig.databaseFilePath), INDEX_FILE_NAME);
}

function isRetriableReplaceError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const code = (error as { code?: unknown }).code;

  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

async function renameWithRetry(sourcePath: string, targetPath: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(sourcePath, targetPath);
      return;
    } catch (error) {
      if (attempt >= WRITE_RETRY_DELAYS_MS.length || !isRetriableReplaceError(error)) throw error;

      await new Promise((resolve) => setTimeout(resolve, WRITE_RETRY_DELAYS_MS[attempt] ?? 0));
    }
  }
}

function isFileNotFound(error: unknown) {
  return Boolean(
    error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

/** Owns durable serialization and atomic replacement of line-index snapshots. */
export class CodexTranscriptLineIndexStorage {
  #pendingSnapshots: ReadonlyMap<string, TranscriptLineIndexSnapshot> | null = null;
  #writeDirty = false;
  #writePromise: Promise<void> | null = null;

  async load() {
    const storagePath = getStoragePath();

    try {
      const raw = await readFile(storagePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedIndexFile>;

      if (!isSupportedPersistedVersion(parsed.version) || !Array.isArray(parsed.snapshots)) {
        return [];
      }

      return parsed.snapshots
        .map(normalizePersistedSnapshot)
        .filter((snapshot): snapshot is PersistedSnapshot => snapshot !== null);
    } catch (error) {
      if (!isFileNotFound(error)) {
        logger.warn("Failed to load Codex transcript line count index", {
          filePath: storagePath,
          message: error instanceof Error ? error.message : String(error)
        });
      }

      return [];
    }
  }

  write(snapshots: ReadonlyMap<string, TranscriptLineIndexSnapshot>) {
    // Keep a reference to the owner map: the drain always serializes the newest
    // mutation, including changes made while an earlier atomic write is active.
    this.#pendingSnapshots = snapshots;
    this.#writeDirty = true;
    if (!this.#writePromise) {
      this.#writePromise = this.#drainWrites().finally(() => {
        this.#writePromise = null;
      });
    }

    return this.#writePromise;
  }

  async #drainWrites() {
    while (this.#writeDirty) {
      this.#writeDirty = false;
      await this.#writeOnce(this.#pendingSnapshots ?? new Map());
    }
  }

  async #writeOnce(snapshotsByPath: ReadonlyMap<string, TranscriptLineIndexSnapshot>) {
    const storagePath = getStoragePath();
    let tempFilePath: string | null = null;
    try {
      await mkdir(dirname(storagePath), { recursive: true });
      const snapshots = Array.from(snapshotsByPath.entries())
        .map(([filePath, snapshot]) => ({ ...snapshot, filePath }));
      tempFilePath = join(dirname(storagePath), `codex-transcript-line-counts.${randomUUID()}.tmp`);

      await writeFile(
        tempFilePath,
        JSON.stringify({
          snapshots,
          updatedAt: new Date().toISOString(),
          version: INDEX_VERSION
        } satisfies PersistedIndexFile, null, 2),
        "utf8"
      );

      await renameWithRetry(tempFilePath, storagePath);
    } catch (error) {
      logger.warn("Failed to write Codex transcript line count index", {
        filePath: storagePath,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      if (tempFilePath) await rm(tempFilePath, { force: true }).catch(() => undefined);
    }
  }
}
