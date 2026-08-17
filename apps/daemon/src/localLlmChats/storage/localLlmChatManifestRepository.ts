import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { AppError } from "#application/errors";

import { mapWithConcurrency, writeJsonAtomic } from "./localLlmChatFileStore.ts";
import { parseLocalLlmChatManifest } from "./localLlmChatStorageSchema.ts";
import type { LocalLlmChatManifest } from "./localLlmChatStorageSchema.ts";

const CHAT_ID_PATTERN = /^[a-z0-9-]{8,}$/;
const DEFAULT_MANIFEST_READ_CONCURRENCY = 16;

/**
 * Owns manifest validation, atomic persistence and per-chat write ordering.
 * The library coordinates domain operations; this repository prevents those
 * operations from racing while updating chat.json.
 */
export class LocalLlmChatManifestRepository {
  private readonly writeChains = new Map<string, Promise<void>>();

  constructor(private readonly rootPath: string) {}

  async read(chatId: string): Promise<LocalLlmChatManifest> {
    if (!CHAT_ID_PATTERN.test(chatId)) throw new AppError("not_found", "Local chat not found.");
    try {
      const raw = await readFile(this.manifestPath(chatId), "utf8");
      const manifest = parseLocalLlmChatManifest(JSON.parse(raw) as unknown, chatId);
      if (!manifest) throw new Error("Invalid local chat manifest.");
      return manifest;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("not_found", "Local chat not found.");
    }
  }

  async create(manifest: LocalLlmChatManifest) {
    await writeJsonAtomic(this.manifestPath(manifest.id), manifest);
  }

  async list(concurrency = DEFAULT_MANIFEST_READ_CONCURRENCY) {
    let entries;
    try {
      entries = await readdir(this.rootPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const chatIds = entries
      .filter((entry) => entry.isDirectory() && CHAT_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name);
    const manifests = await mapWithConcurrency(chatIds, concurrency, async (chatId) => {
      try {
        return await this.read(chatId);
      } catch {
        // One damaged manifest must not hide the rest of the local library.
        return null;
      }
    });
    return manifests.filter((manifest): manifest is LocalLlmChatManifest => manifest !== null);
  }

  async update(chatId: string, update: (manifest: LocalLlmChatManifest) => LocalLlmChatManifest) {
    await this.withWriteLock(chatId, async () => {
      const manifest = await this.read(chatId);
      await writeJsonAtomic(this.manifestPath(chatId), { ...update(manifest), version: 3 });
    });
  }

  async withWriteLock(chatId: string, operation: () => Promise<void>) {
    const previousWrite = this.writeChains.get(chatId) ?? Promise.resolve();
    const currentWrite = previousWrite.catch(() => undefined).then(operation);
    this.writeChains.set(chatId, currentWrite);
    try {
      await currentWrite;
    } finally {
      if (this.writeChains.get(chatId) === currentWrite) this.writeChains.delete(chatId);
    }
  }

  private manifestPath(chatId: string) {
    return path.join(this.rootPath, chatId, "chat.json");
  }
}
