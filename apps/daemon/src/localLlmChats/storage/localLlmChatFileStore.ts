import { randomUUID } from "node:crypto";
import {
  open,
  readFile,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

import { MAX_LOCAL_LLM_JSONL_RECORD_BYTES } from "./localLlmChatStorageLimits.ts";

const ATOMIC_RENAME_MAX_ATTEMPTS = 10;
const ATOMIC_RENAME_RETRY_DELAY_MS = 25;
const FIRST_JSONL_SCAN_CHUNK_BYTES = 64 * 1024;
const FIRST_JSONL_SCAN_MAX_BYTES = MAX_LOCAL_LLM_JSONL_RECORD_BYTES;
const FIRST_JSONL_SCAN_MAX_RECORDS = 64;
const LAST_JSONL_SCAN_CHUNK_BYTES = 64 * 1024;
const LAST_JSONL_SCAN_MAX_BYTES = MAX_LOCAL_LLM_JSONL_RECORD_BYTES * 2;
const LAST_JSONL_SCAN_MAX_RECORDS = 256;

function isRetryableAtomicRenameError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM";
}

export async function readJsonl<T>(filePath: string, isItem: (value: unknown) => value is T): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return isItem(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export async function appendDurableJsonl(filePath: string, value: unknown) {
  const handle = await open(filePath, "a");
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeTextAtomic(filePath: string, content: string) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryPath, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let attempt = 0; attempt < ATOMIC_RENAME_MAX_ATTEMPTS; attempt += 1) {
      try {
        await rename(temporaryPath, filePath);
        return;
      } catch (error) {
        if (!isRetryableAtomicRenameError(error) || attempt === ATOMIC_RENAME_MAX_ATTEMPTS - 1) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(
          resolve,
          Math.min(200, ATOMIC_RENAME_RETRY_DELAY_MS * (attempt + 1))
        ));
      }
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function fileExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await operation(items[index], index);
    }
  }));
  return results;
}

function parseJsonlItem<T>(line: string, isItem: (value: unknown) => value is T): T | null {
  const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (!normalized) return null;
  try {
    const parsed = JSON.parse(normalized) as unknown;
    return isItem(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function readFirstJsonlMatch<T>(
  filePath: string,
  isItem: (value: unknown) => value is T,
  matches: (value: T) => boolean
): Promise<T | null> {
  let handle;
  try {
    handle = await open(filePath, "r");
  } catch {
    return null;
  }

  const chunk = Buffer.allocUnsafe(FIRST_JSONL_SCAN_CHUNK_BYTES);
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let scannedBytes = 0;
  let scannedRecords = 0;
  try {
    while (scannedBytes < FIRST_JSONL_SCAN_MAX_BYTES && scannedRecords < FIRST_JSONL_SCAN_MAX_RECORDS) {
      const remaining = FIRST_JSONL_SCAN_MAX_BYTES - scannedBytes;
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.byteLength, remaining), scannedBytes);
      if (bytesRead === 0) break;
      scannedBytes += bytesRead;
      pending += decoder.write(chunk.subarray(0, bytesRead));
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const rawLine of lines) {
        scannedRecords += 1;
        const item = parseJsonlItem(rawLine, isItem);
        if (item && matches(item)) return item;
        if (scannedRecords >= FIRST_JSONL_SCAN_MAX_RECORDS) return null;
      }
    }
    pending += decoder.end();
    if (pending && scannedRecords < FIRST_JSONL_SCAN_MAX_RECORDS) {
      const item = parseJsonlItem(pending, isItem);
      if (item && matches(item)) return item;
    }
    return null;
  } finally {
    await handle.close();
  }
}

export async function readLastJsonlMatch<T>(
  filePath: string,
  isItem: (value: unknown) => value is T,
  matches: (value: T) => boolean
): Promise<T | null> {
  let fileSize: number;
  try {
    fileSize = (await stat(filePath)).size;
  } catch {
    return null;
  }
  if (fileSize === 0) return null;

  const handle = await open(filePath, "r");
  let position = fileSize;
  let remainder = Buffer.alloc(0);
  let scannedBytes = 0;
  let scannedRecords = 0;
  try {
    while (
      position > 0 &&
      scannedBytes < LAST_JSONL_SCAN_MAX_BYTES &&
      scannedRecords < LAST_JSONL_SCAN_MAX_RECORDS
    ) {
      const readLength = Math.min(
        LAST_JSONL_SCAN_CHUNK_BYTES,
        position,
        LAST_JSONL_SCAN_MAX_BYTES - scannedBytes
      );
      const start = position - readLength;
      const chunk = Buffer.allocUnsafe(readLength);
      const { bytesRead } = await handle.read(chunk, 0, readLength, start);
      if (bytesRead === 0) break;
      scannedBytes += bytesRead;
      const combined = Buffer.concat([chunk.subarray(0, bytesRead), remainder]);
      let lineEnd = combined.length;
      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 10) continue;
        const lineStart = index + 1;
        if (lineEnd > lineStart) {
          scannedRecords += 1;
          const line = combined.subarray(lineStart, lineEnd);
          if (line.byteLength <= MAX_LOCAL_LLM_JSONL_RECORD_BYTES) {
            const item = parseJsonlItem(line.toString("utf8"), isItem);
            if (item && matches(item)) return item;
          }
          if (scannedRecords >= LAST_JSONL_SCAN_MAX_RECORDS) return null;
        }
        lineEnd = index;
      }
      remainder = combined.subarray(0, lineEnd);
      if (remainder.byteLength > MAX_LOCAL_LLM_JSONL_RECORD_BYTES) {
        remainder = Buffer.alloc(0);
      }
      position = start;
    }
    if (
      position === 0 &&
      remainder.length > 0 &&
      remainder.byteLength <= MAX_LOCAL_LLM_JSONL_RECORD_BYTES &&
      scannedRecords < LAST_JSONL_SCAN_MAX_RECORDS
    ) {
      const item = parseJsonlItem(remainder.toString("utf8"), isItem);
      if (item && matches(item)) return item;
    }
    return null;
  } finally {
    await handle.close();
  }
}
