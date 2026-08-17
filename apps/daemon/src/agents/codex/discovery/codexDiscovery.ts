import {
  open,
  readdir,
  readFile,
  stat
} from "node:fs/promises";
import path from "node:path";

import type { CodexSessionSummary } from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

interface IndexedCodexSession {
  id: string;
  thread_name?: string;
  updated_at?: string;
}

interface SessionMetaRecord {
  id: string;
  cwd: string;
  originator?: string;
  cli_version?: string;
  source?: string;
}

export interface SessionFileMetadata {
  filePath: string;
  fileSizeBytes: number;
  model: string | null;
  mtimeMs: number;
  updatedAt: string;
  meta: SessionMetaRecord;
}

interface DiscoveryCache {
  codexHome: string;
  fileMetadataByPath: Map<string, SessionFileMetadata>;
  scannedAt: number;
  summaries: CodexSessionSummary[];
  filesById: Map<string, string>;
}

const SESSION_META_READ_CHUNK_BYTES = 8 * 1024;
const SESSION_META_MAX_READ_BYTES = 64 * 1024;

let discoveryCache: DiscoveryCache | null = null;

async function readFirstLine(filePath: string) {
  const handle = await open(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    let offset = 0;

    while (offset < SESSION_META_MAX_READ_BYTES) {
      const bytesToRead = Math.min(
        SESSION_META_READ_CHUNK_BYTES,
        SESSION_META_MAX_READ_BYTES - offset
      );
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, offset);
      if (bytesRead === 0) {
        break;
      }

      const chunk = buffer.subarray(0, bytesRead);
      const newlineIndex = chunk.indexOf(0x0a);
      if (newlineIndex >= 0) {
        chunks.push(chunk.subarray(0, newlineIndex));
        break;
      }

      chunks.push(chunk);
      offset += bytesRead;
      if (bytesRead < bytesToRead) {
        break;
      }
    }

    const line = Buffer.concat(chunks).toString("utf-8");
    return line.endsWith("\r") ? line.slice(0, -1) : line;
  } finally {
    await handle.close();
  }
}

async function walkJsonlFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, {
    withFileTypes: true
  });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJsonlFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(entryPath);
    }
  }

  return files;
}

function safeParseJson<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function readSessionIndex(sessionIndexPath: string) {
  try {
    const raw = await readFile(sessionIndexPath, "utf-8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => safeParseJson<IndexedCodexSession>(line))
      .filter((value): value is IndexedCodexSession => Boolean(value?.id));
  } catch (error) {
    logger.warn("Failed to read Codex session index", {
      path: sessionIndexPath,
      message: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

async function readSessionFileMetadata(
  filePath: string,
  previousMetadata: SessionFileMetadata | undefined
) {
  try {
    const fileStat = await stat(filePath);
    if (
      previousMetadata &&
      previousMetadata.fileSizeBytes === fileStat.size &&
      previousMetadata.mtimeMs === fileStat.mtimeMs
    ) {
      return previousMetadata;
    }

    const firstLine = await readFirstLine(filePath);
    const record = safeParseJson<{
      type?: string;
      payload?: SessionMetaRecord;
    }>(firstLine);

    if (record?.type !== "session_meta" || !record.payload?.id || !record.payload.cwd) {
      return null;
    }

    return {
      filePath,
      fileSizeBytes: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      updatedAt: fileStat.mtime.toISOString(),
      meta: record.payload,
      model: null
    } satisfies SessionFileMetadata;
  } catch {
    return null;
  }
}

async function readSessionFiles(
  sessionsRoot: string,
  previousFileMetadataByPath: ReadonlyMap<string, SessionFileMetadata> | undefined
) {
  const filesById = new Map<string, SessionFileMetadata>();

  try {
    const files = await walkJsonlFiles(sessionsRoot);

    for (const filePath of files) {
      const metadata = await readSessionFileMetadata(
        filePath,
        previousFileMetadataByPath?.get(filePath)
      );
      if (!metadata) {
        continue;
      }

      filesById.set(metadata.meta.id, metadata);
    }
  } catch (error) {
    logger.warn("Failed to scan Codex session files", {
      path: sessionsRoot,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  return filesById;
}

function selectLatestTimestamp(...values: Array<string | undefined>) {
  let latestValue = "";
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (!value) {
      continue;
    }

    const time = Date.parse(value);
    if (Number.isNaN(time) || time <= latestTime) {
      continue;
    }

    latestTime = time;
    latestValue = value;
  }

  return latestValue || new Date(0).toISOString();
}

export async function loadCodexDiscoveryFromPaths(input: {
  previousFileMetadataByPath?: ReadonlyMap<string, SessionFileMetadata>;
  sessionIndexPath: string;
  sessionsRoot: string;
}) {
  const [indexedSessions, sessionFiles] = await Promise.all([
    readSessionIndex(input.sessionIndexPath),
    readSessionFiles(input.sessionsRoot, input.previousFileMetadataByPath)
  ]);

  const indexedById = new Map(indexedSessions.map((session) => [session.id, session]));
  const ids = new Set<string>([
    ...indexedSessions.map((session) => session.id),
    ...sessionFiles.keys()
  ]);

  const summaries = Array.from(ids)
    .map<CodexSessionSummary | null>((id) => {
      const indexed = indexedById.get(id);
      const file = sessionFiles.get(id);

      if (!file) {
        return null;
      }

      return {
        id,
        threadName:
          indexed?.thread_name?.trim() ||
          `Codex session ${id.slice(0, 8)}`,
        workspacePath: file.meta.cwd,
        workspaceName: path.basename(file.meta.cwd) || file.meta.cwd,
        updatedAt: selectLatestTimestamp(indexed?.updated_at, file.updatedAt),
        model: file.model,
        originator: file.meta.originator ?? null,
        cliVersion: file.meta.cli_version ?? null,
        source: file.meta.source ?? null,
        filePath: file.filePath,
        approvalPolicy: null,
        sandboxMode: null
      } satisfies CodexSessionSummary;
    })
    .filter((item): item is CodexSessionSummary => Boolean(item))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const filesById = new Map(
    summaries.map((summary) => [summary.id, summary.filePath])
  );

  return {
    fileMetadataByPath: new Map(
      Array.from(sessionFiles.values()).map((metadata) => [metadata.filePath, metadata])
    ),
    scannedAt: Date.now(),
    summaries,
    filesById
  };
}

export async function loadCodexDiscovery(force = false) {
  const codexHome = daemonConfig.agentDataRoots.codexHome;
  if (
    !force &&
    discoveryCache &&
    discoveryCache.codexHome === codexHome &&
    Date.now() - discoveryCache.scannedAt < daemonConfig.agentSessionDiscoveryCacheTtlMs
  ) {
    return discoveryCache;
  }

  const discovery = await loadCodexDiscoveryFromPaths({
    previousFileMetadataByPath: discoveryCache?.codexHome === codexHome
      ? discoveryCache.fileMetadataByPath
      : undefined,
    sessionIndexPath: path.join(codexHome, "session_index.jsonl"),
    sessionsRoot: path.join(codexHome, "sessions")
  });

  discoveryCache = {
    ...discovery,
    codexHome
  };

  logger.debug("Codex sessions discovered", {
    sessions: discovery.summaries.length,
    codexHome
  });

  return discoveryCache;
}

export async function listDiscoveredCodexSessions(limit = 12, force = false) {
  const discovery = await loadCodexDiscovery(force);
  return discovery.summaries.slice(0, limit);
}
