import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes
} from "node:fs/promises";
import path from "node:path";

import {
  appendDurableJsonl,
  mapWithConcurrency,
  writeTextAtomic
} from "./localLlmChatFileStore.ts";
import { LocalLlmChatManifestRepository } from "./localLlmChatManifestRepository.ts";
import type { LocalLlmChatManifest } from "./localLlmChatStorageSchema.ts";

const CHAT_ID_PATTERN = /^[a-z0-9-]{8,}$/;
const ARCHIVE_DIRECTORY = "archive";
const ARCHIVE_INDEX_FILE = "archive-index.jsonl";

export const DEFAULT_LOCAL_LLM_LIBRARY_QUOTA_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_LOCAL_LLM_ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const ARCHIVE_PRUNE_INTERVAL_MS = 5 * 60 * 1_000;
const ARCHIVE_SCAN_CONCURRENCY = 8;

export type LocalLlmChatArchiveLifecycleOptions = {
  archiveQuotaBytes: number;
  archiveRetentionMs: number;
  quotaBytes: number;
};

async function getFileSizeIfPresent(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

async function getDirectorySize(directory: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  let size = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) size += await getDirectorySize(entryPath);
    else if (entry.isFile()) size += await getFileSizeIfPresent(entryPath);
  }
  return size;
}

async function getActiveLibrarySize(rootPath: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  let size = 0;
  for (const entry of entries) {
    if (entry.name === ARCHIVE_DIRECTORY) continue;
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) size += await getDirectorySize(entryPath);
    else if (entry.isFile()) size += await getFileSizeIfPresent(entryPath);
  }
  return size;
}

/**
 * Serializes quota enforcement and owns the complete active -> archive ->
 * retention lifecycle. Chat mutations only ask it to preserve the chat they
 * just touched; candidate selection and archive consistency stay here.
 */
export class LocalLlmChatArchiveLifecycle {
  private archiveChain = Promise.resolve();
  private measuredActiveBytes: number | null = null;
  private pendingGrowthBytes = 0;
  private lastArchivePruneAt = 0;

  constructor(
    private readonly rootPath: string,
    private readonly manifests: LocalLlmChatManifestRepository,
    private readonly options: LocalLlmChatArchiveLifecycleOptions
  ) {}

  async enforceQuota(preserveChatId: string, estimatedGrowthBytes = 0) {
    this.pendingGrowthBytes += Math.max(0, estimatedGrowthBytes);
    const archive = this.archiveChain
      .catch(() => undefined)
      .then(() => this.enforceQuotaNow(preserveChatId))
      .catch((error) => {
        this.measuredActiveBytes = null;
        throw error;
      });
    this.archiveChain = archive;
    await archive;
  }

  private async enforceQuotaNow(preserveChatId: string) {
    const now = Date.now();
    if (now - this.lastArchivePruneAt >= ARCHIVE_PRUNE_INTERVAL_MS) {
      await this.pruneArchive(now);
      this.lastArchivePruneAt = now;
    }
    const estimatedGrowthBytes = this.pendingGrowthBytes;
    this.pendingGrowthBytes = 0;
    if (this.measuredActiveBytes === null) {
      this.measuredActiveBytes = await getActiveLibrarySize(this.rootPath);
    } else {
      this.measuredActiveBytes += estimatedGrowthBytes;
    }
    if (this.measuredActiveBytes <= this.options.quotaBytes) return;

    // Estimates deliberately over-count manifest rewrites. Confirm actual disk
    // usage only when the projected total reaches the quota.
    this.measuredActiveBytes = await getActiveLibrarySize(this.rootPath);
    if (this.measuredActiveBytes <= this.options.quotaBytes) return;
    const candidates = (await this.listActiveManifests())
      .filter((manifest) => manifest.id !== preserveChatId && !manifest.activeTurn)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    for (const manifest of candidates) {
      if (this.measuredActiveBytes <= this.options.quotaBytes) break;
      this.measuredActiveBytes = Math.max(
        0,
        this.measuredActiveBytes - await this.archiveInactiveChat(manifest.id)
      );
    }
    this.measuredActiveBytes = await getActiveLibrarySize(this.rootPath);
    await this.pruneArchive(now);
    this.lastArchivePruneAt = now;
  }

  private async listActiveManifests() {
    return this.manifests.list();
  }

  private async archiveInactiveChat(chatId: string) {
    let archivedBytes = 0;
    await this.manifests.withWriteLock(chatId, async () => {
      let manifest: LocalLlmChatManifest;
      try {
        manifest = await this.manifests.read(chatId);
      } catch (error) {
        if ((error as { code?: unknown }).code === "not_found") return;
        throw error;
      }
      if (manifest.activeTurn) return;

      archivedBytes = await getDirectorySize(path.join(this.rootPath, chatId));

      const archivePath = path.join(this.rootPath, ARCHIVE_DIRECTORY, chatId);
      await mkdir(path.dirname(archivePath), { recursive: true });
      try {
        await rename(path.join(this.rootPath, chatId), archivePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          archivedBytes = 0;
          return;
        }
        throw error;
      }
      const archivedAt = new Date();
      await utimes(archivePath, archivedAt, archivedAt);
      await appendDurableJsonl(path.join(this.rootPath, ARCHIVE_INDEX_FILE), {
        archivedAt: archivedAt.toISOString(),
        id: chatId,
        reason: "quota",
        title: manifest.title
      });
    });
    return archivedBytes;
  }

  private async pruneArchive(now = Date.now()) {
    const archiveRoot = path.join(this.rootPath, ARCHIVE_DIRECTORY);
    let directoryEntries;
    try {
      directoryEntries = await readdir(archiveRoot, { withFileTypes: true });
    } catch {
      return;
    }
    const archiveDirectories = directoryEntries
      .filter((entry) => entry.isDirectory() && CHAT_ID_PATTERN.test(entry.name));
    const entries = (await mapWithConcurrency(
      archiveDirectories,
      ARCHIVE_SCAN_CONCURRENCY,
      async (entry) => {
        const entryPath = path.join(archiveRoot, entry.name);
        const entryStat = await stat(entryPath);
        return {
          id: entry.name,
          mtimeMs: entryStat.mtimeMs,
          path: entryPath,
          sizeBytes: await getDirectorySize(entryPath)
        };
      }
    ))
      .sort((left, right) => left.mtimeMs - right.mtimeMs);
    let totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    const retained = [] as typeof entries;
    for (const entry of entries) {
      const expired = now - entry.mtimeMs > this.options.archiveRetentionMs;
      const overQuota = totalBytes > this.options.archiveQuotaBytes;
      if (expired || overQuota) {
        await rm(entry.path, { force: true, recursive: true });
        totalBytes = Math.max(0, totalBytes - entry.sizeBytes);
      } else {
        retained.push(entry);
      }
    }
    const index = await Promise.all(retained.map(async (entry) => {
      let title = "Archived local chat";
      try {
        const manifest = JSON.parse(
          await readFile(path.join(entry.path, "chat.json"), "utf8")
        ) as { title?: unknown };
        if (typeof manifest.title === "string" && manifest.title.trim()) {
          title = manifest.title;
        }
      } catch {
        // Keep a recoverable index entry even if one archived manifest is damaged.
      }
      return JSON.stringify({
        archivedAt: new Date(entry.mtimeMs).toISOString(),
        id: entry.id,
        reason: "quota",
        title
      });
    }));
    await writeTextAtomic(
      path.join(this.rootPath, ARCHIVE_INDEX_FILE),
      index.length > 0 ? `${index.join("\n")}\n` : ""
    );
  }
}
