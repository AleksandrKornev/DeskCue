import type { AgentTranscriptEntry, CodexSessionDetail } from "@deskcue/protocol";

type ByteBoundedCacheOptions<V> = {
  clone: (value: V) => V;
  maxBytes: number;
  maxEntries: number;
  maxItemBytes: number;
  measure: (value: V) => number;
};

type ByteBoundedCacheEntry<V> = {
  bytes: number;
  value: V;
};

/** Small ownership boundary for all transcript LRU bookkeeping. */
export class ByteBoundedCache<K, V> {
  readonly #entries = new Map<K, ByteBoundedCacheEntry<V>>();
  #totalBytes = 0;

  constructor(private readonly options: ByteBoundedCacheOptions<V>) {}

  get(key: K): V | null {
    const entry = this.#entries.get(key);
    if (!entry) {
      return null;
    }

    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return this.options.clone(entry.value);
  }

  set(key: K, value: V) {
    const bytes = this.options.measure(value);
    if (bytes > this.options.maxItemBytes) {
      this.delete(key);
      return false;
    }

    this.delete(key);
    this.#entries.set(key, {
      bytes,
      value: this.options.clone(value)
    });
    this.#totalBytes += bytes;

    while (
      this.#entries.size > this.options.maxEntries ||
      this.#totalBytes > this.options.maxBytes
    ) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.delete(oldestKey);
    }

    return this.#entries.has(key);
  }

  delete(key: K) {
    const entry = this.#entries.get(key);
    if (!entry) {
      return false;
    }

    this.#entries.delete(key);
    this.#totalBytes = Math.max(0, this.#totalBytes - entry.bytes);
    return true;
  }
}

export function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, limit: number) {
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, value);

  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    cache.delete(oldestKey);
  }
}

export function cloneCodexSessionDetail(detail: CodexSessionDetail): CodexSessionDetail {
  return structuredClone(detail);
}

function estimateStringBytes(value: string | null | undefined) {
  return value ? value.length * 2 : 0;
}

function estimateTranscriptEntryBytes(entry: AgentTranscriptEntry) {
  let bytes = 256 +
    estimateStringBytes(entry.id) +
    estimateStringBytes(entry.timestamp) +
    estimateStringBytes(entry.role) +
    estimateStringBytes(entry.text) +
    estimateStringBytes(entry.phase);

  for (const sourceEntryId of entry.sourceEntryIds ?? []) {
    bytes += estimateStringBytes(sourceEntryId);
  }

  for (const range of [...(entry.sourceEntryRanges ?? []), ...(entry.sourceEntrySpans ?? [])]) {
    bytes += 64 + estimateStringBytes(range.prefix);
  }

  for (const part of entry.parts ?? []) {
    bytes += 128;
    for (const value of Object.values(part)) {
      if (typeof value === "string") {
        bytes += estimateStringBytes(value);
      }
    }
  }

  return bytes;
}

export function estimateCodexSessionDetailBytes(detail: CodexSessionDetail) {
  let bytes = 1024 +
    estimateStringBytes(detail.id) +
    estimateStringBytes(detail.threadName) +
    estimateStringBytes(detail.workspacePath) +
    estimateStringBytes(detail.workspaceName) +
    estimateStringBytes(detail.filePath);

  for (const entry of detail.transcript) {
    bytes += estimateTranscriptEntryBytes(entry);
  }

  return bytes;
}

export function estimateTranscriptEntriesBytes(entries: AgentTranscriptEntry[]) {
  return entries.reduce((bytes, entry) => bytes + estimateTranscriptEntryBytes(entry), 0);
}
