import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type LocalLlmWorkspaceFilesystemFileState = {
  content: string | null;
  contentHash: string | null;
  kind: "binary" | "omitted" | "text";
  mtimeMs: number;
  size: number;
};

const MAX_SNAPSHOT_FILES = 2_000;
const MAX_SNAPSHOT_FILE_BYTES = 512 * 1024;
const MAX_SNAPSHOT_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_DIRECTORIES = 512;
const MAX_DIFF_FILES = 256;
const MAX_DIFF_FILE_BYTES = 1024 * 1024;
const MAX_DIFF_TOTAL_BYTES = 8 * 1024 * 1024;
const SNAPSHOT_CONCURRENCY = 8;
const SNAPSHOT_DEADLINE_MS = 7_500;
const GIT_COMMAND_TIMEOUT_MS = 10_000;
const IGNORED_DIRECTORIES = new Set([".deskcue-data", ".git", "node_modules"]);

export function sameWorkspaceFilesystemFileState(
  left: LocalLlmWorkspaceFilesystemFileState | undefined,
  right: LocalLlmWorkspaceFilesystemFileState | undefined
) {
  if (!left || !right) return left === right;
  if (left.kind === "omitted" || right.kind === "omitted") {
    return left.kind === right.kind && left.mtimeMs === right.mtimeMs && left.size === right.size;
  }
  return left.contentHash === right.contentHash && left.kind === right.kind;
}

async function materialiseSnapshotFile(path: string, state: LocalLlmWorkspaceFilesystemFileState | undefined) {
  if (!state) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, state.kind === "binary" ? "\0" : state.content ?? "", "utf8");
}

export async function collectBoundedWorkspaceEvidence(
  factories: ReadonlyArray<(maxOutputBytes: number) => Promise<string>>,
  options: { concurrency: number; maxItemBytes: number; maxTotalBytes: number }
) {
  const concurrency = Math.max(1, Math.trunc(options.concurrency));
  const maxItemBytes = Math.max(1, Math.trunc(options.maxItemBytes));
  let remainingBytes = Math.max(0, Math.trunc(options.maxTotalBytes));
  let nextIndex = 0;
  const retained: string[] = [];

  while (nextIndex < factories.length && remainingBytes > 0) {
    let reservedBytes = 0;
    const batch: Array<{ allocation: number; result: Promise<string> }> = [];
    while (batch.length < concurrency && nextIndex < factories.length) {
      const separatorBytes = retained.length > 0 || batch.length > 0 ? 1 : 0;
      const availableBytes = remainingBytes - reservedBytes - separatorBytes;
      if (availableBytes <= 0) break;
      const allocation = Math.min(maxItemBytes, availableBytes);
      const factory = factories[nextIndex];
      nextIndex += 1;
      reservedBytes += separatorBytes + allocation;
      batch.push({ allocation, result: factory(allocation) });
    }
    if (batch.length === 0) break;

    const results = await Promise.all(batch.map(({ result }) => result));
    for (let index = 0; index < results.length; index += 1) {
      const evidence = results[index];
      if (!evidence) continue;
      const evidenceBytes = Buffer.byteLength(evidence);
      const separatorBytes = retained.length > 0 ? 1 : 0;
      if (evidenceBytes > batch[index].allocation || separatorBytes + evidenceBytes > remainingBytes) {
        return retained.join("\n");
      }
      retained.push(evidence);
      remainingBytes -= separatorBytes + evidenceBytes;
    }
  }

  return retained.join("\n");
}

function normaliseNoIndexPaths(diff: string, filePath: string) {
  return diff.trimEnd()
    .replaceAll(`a/before/${filePath}`, `a/${filePath}`)
    .replaceAll(`b/before/${filePath}`, `b/${filePath}`)
    .replaceAll(`a/after/${filePath}`, `a/${filePath}`)
    .replaceAll(`b/after/${filePath}`, `b/${filePath}`);
}

function keepWithinByteLimit(value: string, maxBytes: number) {
  return Buffer.byteLength(value) <= maxBytes ? value : "";
}

async function runNoIndexDiff(
  temporaryRoot: string,
  filePath: string,
  hasBefore: boolean,
  hasAfter: boolean,
  deadline: number,
  maxOutputBytes: number
) {
  const beforePath = hasBefore ? `before/${filePath}` : "/dev/null";
  const afterPath = hasAfter ? `after/${filePath}` : "/dev/null";
  try {
    const { stdout } = await execFileAsync("git", [
      "diff", "--no-index", "--no-ext-diff", "--unified=3", "--src-prefix=a/", "--dst-prefix=b/", "--",
      beforePath, afterPath
    ], {
      cwd: temporaryRoot,
      maxBuffer: maxOutputBytes,
      timeout: Math.max(1, Math.min(GIT_COMMAND_TIMEOUT_MS, deadline - Date.now()))
    });
    return keepWithinByteLimit(normaliseNoIndexPaths(stdout, filePath), maxOutputBytes);
  } catch (error) {
    const stdout = typeof error === "object" && error && "stdout" in error && typeof error.stdout === "string"
      ? error.stdout
      : "";
    return keepWithinByteLimit(normaliseNoIndexPaths(stdout, filePath), maxOutputBytes);
  }
}

export async function buildWorkspaceFilesystemFileDiff(
  filePath: string,
  before: LocalLlmWorkspaceFilesystemFileState | undefined,
  after: LocalLlmWorkspaceFilesystemFileState | undefined,
  deadline = Date.now() + SNAPSHOT_DEADLINE_MS,
  maxOutputBytes = MAX_DIFF_FILE_BYTES
) {
  if (Date.now() >= deadline || maxOutputBytes <= 0) return "";
  if (before?.kind === "omitted" || after?.kind === "omitted") return "";
  const temporaryRoot = await mkdtemp(join(tmpdir(), "deskcue-local-llm-diff-"));
  const beforePath = join(temporaryRoot, "before", filePath);
  const afterPath = join(temporaryRoot, "after", filePath);
  try {
    await materialiseSnapshotFile(beforePath, before);
    await materialiseSnapshotFile(afterPath, after);
    return await runNoIndexDiff(
      temporaryRoot,
      filePath,
      Boolean(before),
      Boolean(after),
      deadline,
      maxOutputBytes
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

export async function buildObservedWorkspaceFilesystemDiff(
  before: Record<string, LocalLlmWorkspaceFilesystemFileState>,
  after: Record<string, LocalLlmWorkspaceFilesystemFileState>,
  changedFiles: readonly string[]
) {
  const deadline = Date.now() + SNAPSHOT_DEADLINE_MS;
  return collectBoundedWorkspaceEvidence(
    changedFiles.slice(0, MAX_DIFF_FILES).map((filePath) => (maxOutputBytes: number) =>
      buildWorkspaceFilesystemFileDiff(filePath, before[filePath], after[filePath], deadline, maxOutputBytes)
    ),
    {
      concurrency: SNAPSHOT_CONCURRENCY,
      maxItemBytes: MAX_DIFF_FILE_BYTES,
      maxTotalBytes: MAX_DIFF_TOTAL_BYTES
    }
  );
}

function omittedFileState(mtimeMs: number, size: number): LocalLlmWorkspaceFilesystemFileState {
  return { content: null, contentHash: null, kind: "omitted", mtimeMs, size };
}

function fileStateFromBytes(bytes: Buffer, mtimeMs: number, size: number): LocalLlmWorkspaceFilesystemFileState {
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  return bytes.includes(0)
    ? { content: null, contentHash, kind: "binary", mtimeMs, size }
    : { content: bytes.toString("utf8"), contentHash, kind: "text", mtimeMs, size };
}

async function readBoundedFile(path: string, maxBytes: number) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { bytes: buffer.subarray(0, Math.min(bytesRead, maxBytes)), overflow: bytesRead > maxBytes };
  } finally {
    await handle.close();
  }
}

export async function readWorkspaceFilesystemFileState(
  rootPath: string,
  filePath: string
): Promise<LocalLlmWorkspaceFilesystemFileState | undefined> {
  const absolutePath = resolve(rootPath, filePath);
  if (absolutePath !== rootPath && !absolutePath.startsWith(`${rootPath}${sep}`)) return undefined;
  const info = await lstat(absolutePath);
  if (!info.isFile()) return undefined;
  if (info.size > MAX_SNAPSHOT_FILE_BYTES) return omittedFileState(info.mtimeMs, info.size);
  const read = await readBoundedFile(absolutePath, MAX_SNAPSHOT_FILE_BYTES);
  if (read.overflow) return omittedFileState(info.mtimeMs, info.size);
  return fileStateFromBytes(read.bytes, info.mtimeMs, info.size);
}

async function mapWithConcurrency<T>(factories: Array<() => Promise<T>>, limit: number) {
  const results = new Array<T>(factories.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(limit, factories.length) }, async () => {
    while (nextIndex < factories.length) {
      const index = nextIndex++;
      results[index] = await factories[index]();
    }
  }));
  return results;
}

export async function captureWorkspaceFilesystemSnapshot(rootPath: string) {
  const deadline = Date.now() + SNAPSHOT_DEADLINE_MS;
  const pendingFiles: Array<{ absolutePath: string; filePath: string }> = [];
  let capturedContentBytes = 0;
  let directoryCount = 0;
  let truncated = false;
  const pendingDirectories = [rootPath];

  traversal: while (pendingDirectories.length) {
    if (Date.now() >= deadline) {
      truncated = true;
      break;
    }
    const directory = pendingDirectories.pop()!;
    directoryCount += 1;
    if (directoryCount > MAX_SNAPSHOT_DIRECTORIES) {
      truncated = true;
      break;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (Date.now() >= deadline) {
        truncated = true;
        break traversal;
      }
      const absolutePath = resolve(directory, entry.name);
      const filePath = relative(rootPath, absolutePath).split(sep).join("/");
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          if (directoryCount + pendingDirectories.length >= MAX_SNAPSHOT_DIRECTORIES) {
            truncated = true;
          } else {
            pendingDirectories.push(absolutePath);
          }
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (pendingFiles.length >= MAX_SNAPSHOT_FILES) {
        truncated = true;
        break traversal;
      }
      pendingFiles.push({ absolutePath, filePath });
    }
  }

  const entries = await mapWithConcurrency(
    pendingFiles.map(({ absolutePath, filePath }) => async () => {
      try {
        const info = await lstat(absolutePath);
        if (!info.isFile()) return null;
        if (
          Date.now() >= deadline ||
          info.size > MAX_SNAPSHOT_FILE_BYTES ||
          capturedContentBytes + info.size > MAX_SNAPSHOT_CONTENT_BYTES
        ) {
          if (Date.now() >= deadline || capturedContentBytes + info.size > MAX_SNAPSHOT_CONTENT_BYTES) {
            truncated = true;
          }
          return [filePath, omittedFileState(info.mtimeMs, info.size)] as const;
        }
        capturedContentBytes += info.size;
        const reservedBytes = info.size;
        const read = await readBoundedFile(absolutePath, MAX_SNAPSHOT_FILE_BYTES);
        if (read.overflow) {
          capturedContentBytes -= reservedBytes;
          truncated = true;
          return [filePath, omittedFileState(info.mtimeMs, Math.max(info.size, read.bytes.length))] as const;
        }
        const bytes = read.bytes;
        const adjustedContentBytes = capturedContentBytes - reservedBytes + bytes.length;
        if (adjustedContentBytes > MAX_SNAPSHOT_CONTENT_BYTES) {
          capturedContentBytes -= reservedBytes;
          truncated = true;
          return [filePath, omittedFileState(info.mtimeMs, Math.max(info.size, bytes.length))] as const;
        }
        capturedContentBytes = adjustedContentBytes;
        return [filePath, fileStateFromBytes(bytes, info.mtimeMs, info.size)] as const;
      } catch {
        truncated = true;
        return null;
      }
    }),
    SNAPSHOT_CONCURRENCY
  );
  return {
    fileStates: Object.fromEntries(entries.filter((entry) => entry !== null)),
    truncated
  };
}
