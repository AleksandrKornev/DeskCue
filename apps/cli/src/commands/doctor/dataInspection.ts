import {
  closeSync,
  existsSync,
  openSync,
  opendirSync,
  readSync,
  statSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FileStatus, MigrationFailure } from "./types.ts";

export function resolveDataPaths() {
  const defaultDataRoot = fileURLToPath(new URL("../../../../../.deskcue-data/", import.meta.url));
  const dataRoot = readOptionalEnv("DESKCUE_DATA_DIR") ?? defaultDataRoot;
  const serviceDataDir = join(dataRoot, "service");
  const logDir = readOptionalEnv("DESKCUE_LOG_DIR");
  const logFile =
    readOptionalEnv("DESKCUE_LOG_FILE") ??
    (logDir ? join(logDir, "daemon.jsonl") : join(serviceDataDir, "logs", "daemon.jsonl"));

  return {
    databaseFile: readOptionalEnv("DESKCUE_DATABASE_FILE") ?? join(serviceDataDir, "deskcue.sqlite"),
    logFile
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

function insertNewestName(retained: string[], candidate: string, limit: number) {
  if (limit === 0) return;
  const index = retained.findIndex((value) => candidate.localeCompare(value) > 0);
  retained.splice(index < 0 ? retained.length : index, 0, candidate);
  if (retained.length > limit) retained.pop();
}

export function readRecentMigrationFailures(logFile: string): MigrationFailure[] {
  if (!existsSync(logFile)) {
    return [];
  }

  const lines = readFileTailLines(logFile, 500);
  return lines.flatMap((line): MigrationFailure[] => {
    try {
      const payload = JSON.parse(line) as {
        context?: { backupPath?: unknown; databaseFile?: unknown; message?: unknown };
        message?: unknown;
        timestamp?: unknown;
      };
      if (payload.message !== "SQLite schema migration failed") {
        return [];
      }

      return [{
        backupPath: typeof payload.context?.backupPath === "string" ? payload.context.backupPath : null,
        databaseFile: typeof payload.context?.databaseFile === "string" ? payload.context.databaseFile : null,
        detail: typeof payload.context?.message === "string" ? payload.context.message : null,
        message: String(payload.message),
        timestamp: typeof payload.timestamp === "string" ? payload.timestamp : null
      }];
    } catch {
      return [];
    }
  }).slice(-5);
}

const LOG_TAIL_CHUNK_BYTES = 64 * 1024;
const LOG_TAIL_MAX_BYTES = 1024 * 1024;

function readFileTailLines(path: string, lineLimit: number) {
  const size = statSync(path).size;
  if (size === 0 || lineLimit <= 0) {
    return [];
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

  return Buffer.concat(chunks)
    .toString("utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-lineLimit);
}

function readOptionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}
