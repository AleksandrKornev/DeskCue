import type { Stats } from "node:fs";

import type {
  TranscriptLineIndexReadOptions,
  TranscriptLineIndexScanner,
  TranscriptLineIndexSnapshot,
  TranscriptLineOffset
} from "./codexTranscriptLineIndex.types.ts";
import { CodexTranscriptLineIndexStorage } from "./codexTranscriptLineIndexStorage.ts";
export type * from "./codexTranscriptLineIndex.types.ts";

type SnapshotRequest = { promise: Promise<TranscriptLineIndexSnapshot> };

const MAX_CACHED_SNAPSHOTS = 16;
const MAX_EXACT_HINT_OFFSETS = 64;
const MAX_COMPACT_HINT_SPANS = 64;

export function snapshotLineCount(
  snapshot: Pick<TranscriptLineIndexSnapshot, "endsWithLineBreak" | "lineBreakCount">
) {
  return snapshot.lineBreakCount + (snapshot.endsWithLineBreak ? 0 : 1);
}

export function findNearestTranscriptLineOffset(
  lineOffsets: TranscriptLineOffset[] | undefined,
  targetLineIndex: number
): TranscriptLineOffset {
  if (!lineOffsets?.length) {
    return { byteOffset: 0, lineIndex: 0 };
  }
  let nearestOffset = lineOffsets[0] ?? { byteOffset: 0, lineIndex: 0 };
  for (const offset of lineOffsets) {
    if (offset.lineIndex > targetLineIndex) {
      break;
    }
    nearestOffset = offset;
  }
  return nearestOffset;
}

export function findNearestTranscriptByteOffset(
  lineOffsets: TranscriptLineOffset[] | undefined,
  targetByteOffset: number
): TranscriptLineOffset {
  if (!lineOffsets?.length) {
    return { byteOffset: 0, lineIndex: 0 };
  }
  let nearestOffset = lineOffsets[0] ?? { byteOffset: 0, lineIndex: 0 };
  for (const offset of lineOffsets) {
    if (offset.byteOffset > targetByteOffset) {
      break;
    }
    nearestOffset = offset;
  }
  return nearestOffset;
}

function shouldRetainLineHints(snapshot: TranscriptLineIndexSnapshot) {
  if (snapshot.lineHintsComplete !== true) {
    return true;
  }
  return (
    (snapshot.compactLineSpans?.length ?? 0) <= MAX_COMPACT_HINT_SPANS &&
    (snapshot.exactLineOffsets?.length ?? 0) <= MAX_EXACT_HINT_OFFSETS
  );
}

function stripLineHints(snapshot: TranscriptLineIndexSnapshot): TranscriptLineIndexSnapshot {
  return {
    ...snapshot,
    compactLineSpans: undefined,
    exactLineOffsets: undefined,
    lineHintsComplete: false
  };
}

function hasCompleteLineHints(snapshot: TranscriptLineIndexSnapshot) {
  return (
    snapshot.lineHintsComplete === true &&
    snapshot.compactLineSpans !== undefined &&
    snapshot.exactLineOffsets !== undefined &&
    snapshot.chatMessageLineOffsets !== undefined
  );
}

function buildRequestKey(
  filePath: string,
  fileStat: Stats,
  options: TranscriptLineIndexReadOptions
) {
  return [
    filePath,
    fileStat.size,
    fileStat.mtimeMs,
    options.requireOffsets === true ? "offsets" : "count",
    options.requireChatMessageOffsets === true ? "chat-message-offsets" : "",
    options.requireLineHints === true ? "line-hints" : ""
  ].join("\u0000");
}

/**
 * Owns the in-memory and durable lifecycle of the Codex transcript line index.
 * Scanning remains an injected pure file concern so the index can serialize all
 * cache mutations and disk writes without coupling callers to its state.
 */
export class CodexTranscriptLineIndex {
  readonly #scanner: TranscriptLineIndexScanner;
  readonly #storage = new CodexTranscriptLineIndexStorage();
  readonly #snapshots = new Map<string, TranscriptLineIndexSnapshot>();
  readonly #requests = new Map<string, SnapshotRequest>();
  #durableLoaded = false;

  constructor(scanner: TranscriptLineIndexScanner) {
    this.#scanner = scanner;
  }

  async countLineBreaks(filePath: string, fileStat: Stats) {
    return (await this.readSnapshot(filePath, fileStat)).lineBreakCount;
  }

  async readKnownLineCount(filePath: string, fileStat: Stats) {
    return snapshotLineCount(await this.readSnapshot(filePath, fileStat));
  }

  async readCachedSnapshot(filePath: string) {
    await this.#loadDurableIfNeeded();
    return this.#snapshots.get(filePath);
  }

  async updateContextCompactionCount(
    filePath: string,
    source: { compactionCount: number; mtimeMs: number; size: number }
  ) {
    await this.#loadDurableIfNeeded();
    const snapshot = this.#snapshots.get(filePath);
    if (!snapshot || snapshot.size !== source.size) {
      return;
    }
    this.#setSnapshot(filePath, {
      ...snapshot,
      contextCompactionCount: source.compactionCount,
      mtimeMs: source.mtimeMs
    });
    await this.#storage.write(this.#snapshots);
  }

  async readSnapshot(
    filePath: string,
    fileStat: Stats,
    options: TranscriptLineIndexReadOptions = {}
  ): Promise<TranscriptLineIndexSnapshot> {
    const memorySnapshot = await this.#readFromCache(
      filePath,
      fileStat,
      this.#snapshots.get(filePath),
      options
    );
    if (memorySnapshot) {
      return memorySnapshot;
    }

    await this.#loadDurableIfNeeded();

    const durableSnapshot = await this.#readFromCache(
      filePath,
      fileStat,
      this.#snapshots.get(filePath),
      options
    );
    if (durableSnapshot) {
      return durableSnapshot;
    }

    const requestKey = buildRequestKey(filePath, fileStat, options);
    const existingRequest = this.#requests.get(requestKey);
    if (existingRequest) {
      return existingRequest.promise;
    }

    const request = this.#createSnapshot(filePath, fileStat, options)
      .finally(() => {
        if (this.#requests.get(requestKey)?.promise === request) {
          this.#requests.delete(requestKey);
        }
      });
    this.#requests.set(requestKey, { promise: request });
    return request;
  }

  async #readFromCache(
    filePath: string,
    fileStat: Stats,
    cached: TranscriptLineIndexSnapshot | undefined,
    options: TranscriptLineIndexReadOptions
  ): Promise<TranscriptLineIndexSnapshot | null> {
    if (!cached) {
      return null;
    }

    const requireOffsets = options.requireOffsets === true;
    const requireChatMessageOffsets = options.requireChatMessageOffsets === true;
    const requireLineHints = options.requireLineHints === true;

    if (cached.size === fileStat.size) {
      if (requireOffsets && !cached.lineOffsets?.length) {
        return null;
      }
      if (requireChatMessageOffsets && cached.chatMessageLineOffsets === undefined) {
        return null;
      }
      if (requireLineHints && !hasCompleteLineHints(cached)) {
        return null;
      }

      if (cached.mtimeMs !== fileStat.mtimeMs) {
        const updated = { ...cached, mtimeMs: fileStat.mtimeMs };
        this.#setSnapshot(filePath, updated);
        await this.#storage.write(this.#snapshots);
        return updated;
      }
      return cached;
    }

    if (cached.size < fileStat.size) {
      if (requireOffsets && (!cached.lineOffsets?.length || cached.endsWithLineBreak === false)) {
        return null;
      }
      if (requireChatMessageOffsets && cached.chatMessageLineOffsets === undefined) {
        return null;
      }
      if (requireLineHints && !hasCompleteLineHints(cached)) {
        return null;
      }

      const updated = await this.#scanner.readAppendSnapshot(cached, filePath, {
        appendStartByteOffset: cached.size,
        mtimeMs: fileStat.mtimeMs,
        requireChatMessageOffsets:
          requireChatMessageOffsets || cached.chatMessageLineOffsets !== undefined,
        requireLineHints: requireLineHints || cached.lineHintsComplete === true,
        requireOffsets,
        size: fileStat.size
      });
      this.#setSnapshot(filePath, updated);
      await this.#storage.write(this.#snapshots);
      return updated;
    }

    // A truncation/rewrite invalidates the prior snapshot. The caller will run
    // a complete scan and atomically replace the durable v6 record.
    return null;
  }

  async #createSnapshot(
    filePath: string,
    fileStat: Stats,
    options: TranscriptLineIndexReadOptions
  ) {
    const snapshot = await this.#scanner.readFullSnapshot(filePath, fileStat, {
      includeChatMessageOffsets:
        options.requireChatMessageOffsets === true || options.requireLineHints === true,
      includeLineHints: options.requireLineHints === true,
      includeOffsets: options.requireOffsets === true
    });
    this.#setSnapshot(filePath, snapshot);
    await this.#storage.write(this.#snapshots);
    return snapshot;
  }

  #setSnapshot(filePath: string, snapshot: TranscriptLineIndexSnapshot) {
    const retained = shouldRetainLineHints(snapshot)
      ? snapshot
      : stripLineHints(snapshot);
    this.#snapshots.delete(filePath);
    this.#snapshots.set(filePath, retained);
    while (this.#snapshots.size > MAX_CACHED_SNAPSHOTS) {
      const oldest = this.#snapshots.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#snapshots.delete(oldest);
    }
  }

  async #loadDurableIfNeeded() {
    if (this.#durableLoaded) {
      return;
    }
    this.#durableLoaded = true;
    for (const snapshot of await this.#storage.load()) {
      const { filePath, ...value } = snapshot;
      this.#setSnapshot(filePath, value);
    }
  }
}
