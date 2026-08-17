import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type {
  AgentSessionIndexSnapshotMeta,
  SourceAgentIndexStatsResponse
} from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

import {
  countSourceAgentSnapshotSessions,
  estimateSnapshotEnvelopeBytes,
  hashSourceAgentCacheKey,
  isStoredSourceAgentIndexSnapshot,
  mapWithConcurrency,
  measureSourceAgentSnapshotBytes,
  renameSourceAgentIndexWithRetry
} from "./sourceAgentSessionIndexIo.ts";
import type {
  DescriptorSessionLists,
  StoredSourceAgentIndexSnapshot
} from "./sourceAgentSessionIndexIo.ts";

type SourceAgentIndexSnapshot = StoredSourceAgentIndexSnapshot & {
  sizeBytes: number;
  storage: "memory" | "disk";
};

type StoredSourceAgentIndex = {
  snapshots: StoredSourceAgentIndexSnapshot[];
  version: 1;
};

type ReadSourceAgentIndexSnapshotOptions = {
  cacheKey: string;
  force: boolean;
  refresh: () => Promise<DescriptorSessionLists>;
};

type ReadSourceAgentIndexSnapshotResult = {
  indexSnapshot: AgentSessionIndexSnapshotMeta;
  sessions: DescriptorSessionLists;
};

export type SourceAgentSessionIndexOptions = {
  getFilePath?: () => string;
  getSnapshotTtlMs?: () => number;
  getSnapshotByteLimit?: () => number;
  now?: () => number;
};

const SOURCE_AGENT_INDEX_FILE_VERSION = 1;
const SOURCE_AGENT_INDEX_ORPHAN_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const SOURCE_AGENT_INDEX_STALE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const SOURCE_AGENT_INDEX_SNAPSHOT_LIMIT = 128;
const SOURCE_AGENT_INDEX_SNAPSHOT_BYTE_LIMIT = 8 * 1024 * 1024;

export class SourceAgentSessionIndex {
  private readonly getFilePath: () => string;
  private readonly getSnapshotTtlMs: () => number;
  private readonly getSnapshotByteLimit: () => number;
  private readonly now: () => number;
  private readonly snapshots = new Map<string, SourceAgentIndexSnapshot>();
  private readonly refreshPromises = new Map<string, Promise<SourceAgentIndexSnapshot>>();
  private activeFilePath: string | null = null;
  private generation = 0;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private saveChain = Promise.resolve();
  private closePromise: Promise<void> | null = null;
  private closed = false;

  constructor(options: SourceAgentSessionIndexOptions = {}) {
    this.getFilePath = options.getFilePath ?? (() => daemonConfig.agentSessionIndexFilePath);
    this.getSnapshotTtlMs =
      options.getSnapshotTtlMs ?? (() => daemonConfig.agentSessionIndexSnapshotTtlMs);
    this.getSnapshotByteLimit =
      options.getSnapshotByteLimit ?? (() => SOURCE_AGENT_INDEX_SNAPSHOT_BYTE_LIMIT);
    this.now = options.now ?? Date.now;
  }

  async readSnapshot({
    cacheKey,
    force,
    refresh
  }: ReadSourceAgentIndexSnapshotOptions): Promise<ReadSourceAgentIndexSnapshotResult> {
    if (this.closed) throw new Error("Source-agent session index is closed.");
    const filePath = await this.ensureLoaded();
    if (this.closed) throw new Error("Source-agent session index is closed.");

    if (force) {
      return this.readRefreshedSnapshot({
        cacheKey,
        filePath,
        readMode: "snapshot-miss",
        refresh
      });
    }

    const cached = this.snapshots.get(cacheKey);
    if (cached) {
      const ageMs = this.readSnapshotAgeMs(cached);
      if (ageMs !== null && ageMs <= this.getSnapshotTtlMs()) {
        return {
          indexSnapshot: this.buildIndexSnapshotMeta(cached, {
            readMode: "snapshot-fresh",
            refreshing: false
          }),
          sessions: cached.sessions
        };
      }

      this.refreshSnapshotInBackground({ cacheKey, filePath, refresh });
      return {
        indexSnapshot: this.buildIndexSnapshotMeta(cached, {
          readMode: "snapshot-stale",
          refreshing: this.refreshPromises.has(cacheKey)
        }),
        sessions: cached.sessions
      };
    }

    return this.readRefreshedSnapshot({
      cacheKey,
      filePath,
      readMode: "snapshot-miss",
      refresh
    });
  }

  readStats(): SourceAgentIndexStatsResponse {
    const filePath = this.selectFilePath();
    return {
      filePath,
      refreshingCount: this.refreshPromises.size,
      snapshotCount: this.snapshots.size,
      snapshotTtlMs: this.getSnapshotTtlMs(),
      snapshots: Array.from(this.snapshots.values())
        .map((snapshot) => ({
          ageMs: this.readSnapshotAgeMs(snapshot),
          cacheKeyHash: hashSourceAgentCacheKey(snapshot.cacheKey),
          cachedAt: snapshot.cachedAt,
          sessionCount: countSourceAgentSnapshotSessions(snapshot.sessions),
          storage: snapshot.storage
        }))
        .sort((left, right) => (right.cachedAt ?? "").localeCompare(left.cachedAt ?? ""))
    };
  }

  reset() {
    this.generation += 1;
    this.snapshots.clear();
    this.refreshPromises.clear();
    this.activeFilePath = null;
    this.loaded = false;
    this.closed = false;
    this.closePromise = null;
    this.loadPromise = null;
    this.saveChain = Promise.resolve();
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.generation += 1;
    const pending = [
      ...(this.loadPromise ? [this.loadPromise] : []),
      ...this.refreshPromises.values(),
      this.saveChain
    ];
    this.closePromise = Promise.allSettled(pending).then(() => {
      this.refreshPromises.clear();
      this.snapshots.clear();
    });
    return this.closePromise;
  }

  async waitForIdle() {
    await Promise.all([...this.refreshPromises.values()]);
    await this.saveChain;
  }

  private selectFilePath() {
    const filePath = this.getFilePath();
    if (this.activeFilePath === filePath) return filePath;

    this.generation += 1;
    this.snapshots.clear();
    this.refreshPromises.clear();
    this.activeFilePath = filePath;
    this.loaded = false;
    this.loadPromise = null;
    this.saveChain = Promise.resolve();
    return filePath;
  }

  private async ensureLoaded() {
    const filePath = this.selectFilePath();
    if (this.loaded) return filePath;

    if (!this.loadPromise) {
      const generation = this.generation;
      this.loadPromise = this.loadFromDisk(filePath, generation);
    }
    await this.loadPromise;
    return filePath;
  }

  private async loadFromDisk(filePath: string, generation: number) {
    await this.pruneOrphanedTemps(filePath);
    const loadedSnapshots: SourceAgentIndexSnapshot[] = [];
    let prunedSnapshots = 0;
    try {
      const fileStats = await stat(filePath);
      if (fileStats.size > this.getSnapshotByteLimit()) {
        prunedSnapshots += 1;
        logger.warn("Discarding oversized source-agent index snapshot file", {
          filePath,
          sizeBytes: fileStats.size
        });
        return;
      }
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredSourceAgentIndex>;
      if (parsed.version !== SOURCE_AGENT_INDEX_FILE_VERSION || !Array.isArray(parsed.snapshots)) return;

      for (const snapshot of parsed.snapshots) {
        if (!isStoredSourceAgentIndexSnapshot(snapshot)) continue;
        const cachedAtMs = Date.parse(snapshot.cachedAt);
        if (
          !Number.isFinite(cachedAtMs) ||
          cachedAtMs < this.now() - SOURCE_AGENT_INDEX_STALE_RETENTION_MS
        ) {
          prunedSnapshots += 1;
          continue;
        }
        const sizeBytes = measureSourceAgentSnapshotBytes(snapshot);
        if (sizeBytes > this.getSnapshotByteLimit()) {
          prunedSnapshots += 1;
          continue;
        }
        loadedSnapshots.push({ ...snapshot, sizeBytes, storage: "disk" });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.debug("Source-agent index snapshot load failed", {
          message: error instanceof Error ? error.message : String(error)
        });
      }
    } finally {
      if (generation !== this.generation || filePath !== this.activeFilePath) return;
      for (const snapshot of loadedSnapshots) {
        this.snapshots.set(snapshot.cacheKey, snapshot);
      }
      prunedSnapshots += this.pruneSnapshots();
      this.loaded = true;
      if (prunedSnapshots > 0) {
        await this.persist(filePath, generation);
        logger.info("Pruned stale source-agent index snapshots", { prunedSnapshots });
      }
    }
  }

  private async pruneOrphanedTemps(filePath: string, now = this.now()) {
    const directory = dirname(filePath);
    const fileNamePrefix = `${basename(filePath)}.`;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.debug("Source-agent index temp cleanup failed", {
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    let prunedFiles = 0;
    await mapWithConcurrency(entries, 8, async (entry) => {
      if (!entry.isFile() || !entry.name.startsWith(fileNamePrefix)) return;
      const suffix = entry.name.slice(fileNamePrefix.length);
      if (!/^\d+\.[^.]+\.tmp$/.test(suffix)) return;

      const temporaryPath = join(directory, entry.name);
      try {
        const fileStats = await stat(temporaryPath);
        if (now - fileStats.mtimeMs <= SOURCE_AGENT_INDEX_ORPHAN_TEMP_MAX_AGE_MS) return;
        await rm(temporaryPath, { force: true });
        prunedFiles += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          logger.debug("Source-agent index temp cleanup skipped a file", {
            filePath: temporaryPath,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    });

    if (prunedFiles > 0) logger.info("Pruned orphaned source-agent index temp files", { directory, prunedFiles });
  }

  private async readRefreshedSnapshot({
    cacheKey,
    filePath,
    readMode,
    refresh
  }: {
    cacheKey: string;
    filePath: string;
    readMode: AgentSessionIndexSnapshotMeta["readMode"];
    refresh: () => Promise<DescriptorSessionLists>;
  }): Promise<ReadSourceAgentIndexSnapshotResult> {
    const snapshot = await this.refreshSnapshot({ cacheKey, filePath, refresh });
    return {
      indexSnapshot: this.buildIndexSnapshotMeta(snapshot, { readMode, refreshing: false }),
      sessions: snapshot.sessions
    };
  }

  private refreshSnapshot({
    cacheKey,
    filePath,
    refresh
  }: {
    cacheKey: string;
    filePath: string;
    refresh: () => Promise<DescriptorSessionLists>;
  }) {
    const activeRefresh = this.refreshPromises.get(cacheKey);
    if (activeRefresh) return activeRefresh;

    const generation = this.generation;
    const operation = (async () => {
      const sessions = await refresh();
      const cachedAt = new Date(this.now()).toISOString();
      const snapshot: SourceAgentIndexSnapshot = {
        cacheKey,
        cachedAt,
        sessions,
        sizeBytes: measureSourceAgentSnapshotBytes({ cacheKey, cachedAt, sessions }),
        storage: "memory"
      };
      if (generation === this.generation && filePath === this.activeFilePath) {
        if (snapshot.sizeBytes <= this.getSnapshotByteLimit()) this.snapshots.set(cacheKey, snapshot);
        this.pruneSnapshots();
        await this.persist(filePath, generation);
      }
      return snapshot;
    })();
    const trackedOperation = operation.finally(() => {
      if (this.refreshPromises.get(cacheKey) === trackedOperation) this.refreshPromises.delete(cacheKey);
    });
    this.refreshPromises.set(cacheKey, trackedOperation);
    return trackedOperation;
  }

  private refreshSnapshotInBackground(options: {
    cacheKey: string;
    filePath: string;
    refresh: () => Promise<DescriptorSessionLists>;
  }) {
    void this.refreshSnapshot(options).catch((error) => {
      logger.debug("Source-agent index snapshot refresh failed", {
        message: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private async persist(filePath: string, generation: number) {
    const save = this.saveChain
      .catch(() => undefined)
      .then(() => this.persistNow(filePath, generation));
    this.saveChain = save;
    await save;
  }

  private async persistNow(filePath: string, generation: number) {
    if (generation !== this.generation || filePath !== this.activeFilePath) return;
    this.pruneSnapshots();
    const payload: StoredSourceAgentIndex = {
      version: SOURCE_AGENT_INDEX_FILE_VERSION,
      snapshots: Array.from(this.snapshots.values()).map((snapshot) => ({
        cacheKey: snapshot.cacheKey,
        cachedAt: snapshot.cachedAt,
        sessions: snapshot.sessions
      }))
    };
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(filePath), { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify(payload)}\n`, "utf8");
      await renameSourceAgentIndexWithRetry(temporary, filePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private pruneSnapshots(now = this.now()) {
    let pruned = 0;
    for (const [cacheKey, snapshot] of this.snapshots) {
      const cachedAt = Date.parse(snapshot.cachedAt);
      if (!Number.isFinite(cachedAt) || cachedAt < now - SOURCE_AGENT_INDEX_STALE_RETENTION_MS) {
        this.snapshots.delete(cacheKey);
        pruned += 1;
      }
    }
    const oldest = Array.from(this.snapshots.values())
      .sort((left, right) => left.cachedAt.localeCompare(right.cachedAt));
    let totalBytes = oldest.reduce((total, snapshot) => total + snapshot.sizeBytes, 0);
    for (const snapshot of oldest) {
      if (
        this.snapshots.size <= SOURCE_AGENT_INDEX_SNAPSHOT_LIMIT &&
        totalBytes + estimateSnapshotEnvelopeBytes(this.snapshots.size) <=
          this.getSnapshotByteLimit()
      ) {
        break;
      }
      if (this.snapshots.delete(snapshot.cacheKey)) {
        totalBytes -= snapshot.sizeBytes;
        pruned += 1;
      }
    }
    return pruned;
  }

  private buildIndexSnapshotMeta(
    snapshot: SourceAgentIndexSnapshot,
    options: {
      readMode: AgentSessionIndexSnapshotMeta["readMode"];
      refreshing: boolean;
    }
  ): AgentSessionIndexSnapshotMeta {
    return {
      ageMs: this.readSnapshotAgeMs(snapshot),
      cachedAt: snapshot.cachedAt,
      readMode: options.readMode,
      refreshing: options.refreshing,
      sessionCount: countSourceAgentSnapshotSessions(snapshot.sessions),
      storage: snapshot.storage
    };
  }

  private readSnapshotAgeMs(snapshot: SourceAgentIndexSnapshot) {
    const cachedAtMs = Date.parse(snapshot.cachedAt);
    return Number.isFinite(cachedAtMs) ? Math.max(0, this.now() - cachedAtMs) : null;
  }
}

export function createSourceAgentSessionIndex(options: SourceAgentSessionIndexOptions = {}) {
  return new SourceAgentSessionIndex(options);
}
