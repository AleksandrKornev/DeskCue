import {
  closeSync,
  existsSync,
  openSync,
  opendirSync,
  readSync,
  statSync
} from "node:fs";
import { basename, dirname, join } from "node:path";

import type { FileStatus, MigrationFailure } from "./types.ts";
import { resolveCliDataPaths } from "../../paths.ts";

const LOG_TAIL_CHUNK_BYTES = 64 * 1024;
const LOG_TAIL_MAX_BYTES = 1024 * 1024;
const LOG_TAIL_ANCHOR_BYTES = 64;

type MigrationLogContext = {
  backupPath?: unknown;
  databaseFile?: unknown;
  message?: unknown;
  toVersion?: unknown;
};

type PendingMigrationFailure = MigrationFailure & {
  toVersion: number | null;
};

function readMigrationVersion(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isResolvedMigrationFailure(
  failure: PendingMigrationFailure,
  context: MigrationLogContext
) {
  if (typeof context.databaseFile !== "string" || failure.databaseFile !== context.databaseFile) return false;

  const succeededVersion = readMigrationVersion(context.toVersion);

  return failure.toVersion === null || succeededVersion === null || failure.toVersion === succeededVersion;
}

function isCompleteJsonLine(value: string) {
  if (!value) return false;

  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function insertNewestName(retained: string[], candidate: string, limit: number) {
  if (limit === 0) return;

  const index = retained.findIndex((value) => candidate.localeCompare(value) > 0);

  retained.splice(index < 0 ? retained.length : index, 0, candidate);

  if (retained.length > limit) retained.pop();
}

export function readBoundedFileTail(path: string, lineLimit: number) {
  const size = statSync(path).size;

  if (size === 0 || lineLimit <= 0) {
    return { endAnchor: "", fileSize: size, lines: [], pendingText: "", truncated: false };
  }

  const file = openSync(path, "r");
  const chunks: Buffer[] = [];
  let position = size;
  let totalBytes = 0;
  let newlineCount = 0;

  try {
    while (position > 0 && totalBytes < LOG_TAIL_MAX_BYTES && newlineCount <= lineLimit) {
      const bytesToRead = Math.min(
        LOG_TAIL_CHUNK_BYTES,
        position,
        LOG_TAIL_MAX_BYTES - totalBytes
      );

      position -= bytesToRead;
      const chunk = Buffer.allocUnsafe(bytesToRead);
      const bytesRead = readSync(file, chunk, 0, bytesToRead, position);
      const value = bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead);

      chunks.unshift(value);

      totalBytes += value.length;
      for (const byte of value) {
        if (byte === 0x0a) newlineCount += 1;
      }
    }
  } finally {
    closeSync(file);
  }

  const truncated = position > 0 && newlineCount <= lineLimit;
  const buffer = Buffer.concat(chunks);
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  const endsWithNewline = buffer.at(-1) === 0x0a;
  const finalSegment = endsWithNewline ? "" : lines.pop() ?? "";
  const finalSegmentComplete = isCompleteJsonLine(finalSegment);
  const pendingText = finalSegmentComplete || (truncated && !text.includes("\n")) ? "" : finalSegment;

  if (truncated) lines.shift();
  if (finalSegmentComplete) lines.push(finalSegment);

  return {
    endAnchor: buffer.subarray(Math.max(0, buffer.length - LOG_TAIL_ANCHOR_BYTES)).toString("utf8"),
    fileSize: size,
    lines: lines
      .filter(Boolean)
      .slice(-lineLimit),
    pendingText,
    truncated
  };
}

export function readFileTailLines(path: string, lineLimit: number) {
  return readBoundedFileTail(path, lineLimit).lines;
}

export function resolveDataPaths() {
  const paths = resolveCliDataPaths();

  return {
    databaseFile: paths.databaseFile,
    logFile: paths.logFile
  };
}

export function readFileStatus(path: string): FileStatus {
  if (!existsSync(path)) {
    return { exists: false, path };
  }

  const stats = statSync(path);

  return {
    exists: true,
    modifiedAt: stats.mtime.toISOString(),
    path,
    sizeBytes: stats.size
  };
}

export function listDatabaseBackups(databaseFile: string, limit = 5) {
  const databaseDir = dirname(databaseFile);
  const databaseName = basename(databaseFile);

  if (!existsSync(databaseDir)) {
    return { backups: [], totalCount: 0 };
  }

  const retainedNames: string[] = [];
  let totalCount = 0;
  const retainedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5;
  const directory = opendirSync(databaseDir);

  try {
    let entry;

    while ((entry = directory.readSync()) !== null) {
      if (!entry.isFile() || !entry.name.startsWith(`${databaseName}.backup-`)) continue;

      totalCount += 1;
      insertNewestName(retainedNames, entry.name, retainedLimit);
    }
  } finally {
    directory.closeSync();
  }

  const backups = retainedNames
    .map((fileName) => {
      const path = join(databaseDir, fileName);
      const stats = statSync(path);

      return {
        modifiedAt: stats.mtime.toISOString(),
        path,
        sizeBytes: stats.size
      };
    })
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return { backups, totalCount };
}

export function readRecentMigrationFailures(logFile: string): MigrationFailure[] {
  if (!existsSync(logFile)) {
    return [];
  }

  const lines = readFileTailLines(logFile, 500);
  const failures: PendingMigrationFailure[] = [];

  for (const line of lines) {
    try {
      const payload = JSON.parse(line) as {
        context?: MigrationLogContext;
        message?: unknown;
        timestamp?: unknown;
      };

      if (payload.message === "SQLite schema migrated" && payload.context) {
        for (let index = failures.length - 1; index >= 0; index -= 1) {
          if (isResolvedMigrationFailure(failures[index]!, payload.context)) failures.splice(index, 1);
        }

        continue;
      }

      if (payload.message !== "SQLite schema migration failed") continue;

      failures.push({
        backupPath: typeof payload.context?.backupPath === "string" ? payload.context.backupPath : null,
        databaseFile: typeof payload.context?.databaseFile === "string" ? payload.context.databaseFile : null,
        detail: typeof payload.context?.message === "string" ? payload.context.message : null,
        message: String(payload.message),
        timestamp: typeof payload.timestamp === "string" ? payload.timestamp : null,
        toVersion: readMigrationVersion(payload.context?.toVersion)
      });
    } catch {
      continue;
    }
  }

  return failures.slice(-5).map(({ toVersion: _toVersion, ...failure }) => failure);
}
