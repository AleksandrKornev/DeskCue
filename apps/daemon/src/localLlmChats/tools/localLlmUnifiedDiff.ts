import {
  lstat,
  open,
  realpath,
  stat
} from "node:fs/promises";
import path from "node:path";

import { LocalLlmToolError } from "./localLlmToolTypes.ts";
import type { LocalLlmToolExecutorLimits } from "./localLlmToolTypes.ts";
import {
  commitLocalLlmUnifiedDiffPlans,
  defaultLocalLlmUnifiedDiffCommitOperations,
  MAX_LOCAL_LLM_PATCH_BACKUP_BYTES,
  recoverLocalLlmUnifiedDiffTransactions,
  withLocalLlmWorkspacePatchLock
} from "./localLlmUnifiedDiffJournal.ts";
import type { LocalLlmUnifiedDiffCommitOperations } from "./localLlmUnifiedDiffJournal.ts";
import {
  assertInsideLocalLlmWorkspace,
  resolveLocalLlmExistingPath,
  resolveLocalLlmWorkspacePath,
  toLocalLlmWorkspaceRelative
} from "./localLlmWorkspaceFilesystem.ts";

export type { LocalLlmUnifiedDiffCommitOperations } from "./localLlmUnifiedDiffJournal.ts";

type UnifiedFilePatch = {
  additions: number;
  deletions: number;
  from: string | null;
  hunks: UnifiedHunk[];
  to: string | null;
};

type UnifiedHunk = {
  lines: Array<{ kind: "add" | "context" | "remove"; value: string }>;
  newStart: number;
  oldStart: number;
};

type FilePlan = {
  additions: number;
  deletions: number;
  nextContent: string | null;
  path: string;
  previousContent: string | null;
  relativePath: string;
};

export async function recoverPendingLocalLlmUnifiedDiff(
  root: string,
  operations: LocalLlmUnifiedDiffCommitOperations = defaultLocalLlmUnifiedDiffCommitOperations
) {
  const canonicalRoot = await realpath(root);
  return withLocalLlmWorkspacePatchLock(canonicalRoot, () =>
    recoverLocalLlmUnifiedDiffTransactions(canonicalRoot, operations)
  );
}

function normalizeDiffPath(value: string) {
  const raw = value.split("\t", 1)[0].trim();
  if (raw === "/dev/null") return null;
  const normalized = raw.replace(/^[ab]\//, "");
  if (!normalized || path.isAbsolute(normalized) || normalized.split(/[\\/]+/).includes("..")) {
    throw new LocalLlmToolError("Diff paths must be relative paths inside the attached workspace.");
  }
  return normalized;
}

function parseUnifiedDiff(patch: string): UnifiedFilePatch[] {
  const lines = patch.replaceAll("\r\n", "\n").split("\n");
  const result: UnifiedFilePatch[] = [];
  let current: UnifiedFilePatch | null = null;
  let hunk: UnifiedHunk | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("--- ")) {
      const next = lines[index + 1];
      if (!next?.startsWith("+++ ")) {
        throw new LocalLlmToolError("Each unified diff file header must include --- and +++ lines.");
      }
      current = {
        additions: 0,
        deletions: 0,
        from: normalizeDiffPath(line.slice(4)),
        hunks: [],
        to: normalizeDiffPath(next.slice(4))
      };
      if (!current.from && !current.to) {
        throw new LocalLlmToolError("A diff cannot use /dev/null for both paths.");
      }
      result.push(current);
      hunk = null;
      index += 1;
      continue;
    }
    if (line.startsWith("@@ ")) {
      if (!current) {
        throw new LocalLlmToolError("Diff hunk appeared before a file header.");
      }
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (!match) {
        throw new LocalLlmToolError("Invalid unified diff hunk header.");
      }
      hunk = { lines: [], oldStart: Number(match[1]), newStart: Number(match[2]) };
      current.hunks.push(hunk);
      continue;
    }
    if (line === "\\ No newline at end of file") {
      continue;
    }
    if (hunk && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-"))) {
      const kind = line[0] === "+" ? "add" : line[0] === "-" ? "remove" : "context";
      hunk.lines.push({ kind, value: line.slice(1) });
      if (kind === "add") current!.additions += 1;
      if (kind === "remove") current!.deletions += 1;
      continue;
    }
    if (line.startsWith("diff --git ") || line.startsWith("index ")) {
      continue;
    }
    if (line.length > 0) {
      throw new LocalLlmToolError("Unsupported content in unified diff.");
    }
  }
  if (result.some((entry) => entry.hunks.length === 0)) {
    throw new LocalLlmToolError("Each patched file needs at least one hunk.");
  }
  return result;
}

async function readPatchSource(root: string, targetPath: string, maxBytes: number) {
  const resolved = await resolveLocalLlmExistingPath(root, toLocalLlmWorkspaceRelative(root, targetPath));
  if (!(await stat(resolved)).isFile()) throw new LocalLlmToolError("Patch source is not a file.");
  const handle = await open(resolved, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (bytesRead > maxBytes) {
      throw new LocalLlmToolError("Patch source exceeds the configured size limit.");
    }
    const content = buffer.subarray(0, bytesRead);
    if (content.includes(0)) throw new LocalLlmToolError("Binary files cannot be patched.");
    return content.toString("utf8");
  } finally {
    await handle.close();
  }
}

async function assertWritableTarget(root: string, targetPath: string) {
  let parent = path.dirname(targetPath);
  while (parent !== root) {
    try {
      const resolved = await realpath(parent);
      assertInsideLocalLlmWorkspace(root, resolved);
      return;
    } catch (error) {
      if (error instanceof LocalLlmToolError) throw error;
      parent = path.dirname(parent);
    }
  }
}

function applyHunks(source: string, hunks: UnifiedHunk[]) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = source.endsWith("\n");
  const sourceLines = source === "" ? [] : source.replaceAll("\r\n", "\n").replace(/\n$/, "").split("\n");
  const output = [...sourceLines];
  let offset = 0;
  for (const hunk of hunks) {
    let cursor = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1 + offset;
    for (const line of hunk.lines) {
      if (line.kind === "context") {
        if (output[cursor] !== line.value) throw new LocalLlmToolError("Patch context does not match the current file.");
        cursor += 1;
      } else if (line.kind === "remove") {
        if (output[cursor] !== line.value) throw new LocalLlmToolError("Patch removal does not match the current file.");
        output.splice(cursor, 1);
        offset -= 1;
      } else {
        output.splice(cursor, 0, line.value);
        cursor += 1;
        offset += 1;
      }
    }
  }
  if (output.length === 0) return "";
  return `${output.join(newline)}${hadTrailingNewline || source === "" ? newline : ""}`;
}

async function planFilePatch(root: string, patch: UnifiedFilePatch, maxSourceBytes: number): Promise<FilePlan> {
  if (patch.from && patch.to && patch.from !== patch.to) {
    throw new LocalLlmToolError("Renames are not supported in local model patches.");
  }
  const relativePath = patch.to ?? patch.from;
  if (!relativePath) throw new LocalLlmToolError("Missing patch path.");
  const targetPath = resolveLocalLlmWorkspacePath(root, relativePath);
  try {
    if ((await lstat(targetPath)).isSymbolicLink()) {
      throw new LocalLlmToolError("Patches cannot write through symbolic links.");
    }
  } catch (error) {
    if (error instanceof LocalLlmToolError) throw error;
    // A new file has no target yet; its nearest existing parent is checked below.
  }
  const previousContent = patch.from ? await readPatchSource(root, targetPath, maxSourceBytes) : null;
  const nextContent = applyHunks(previousContent ?? "", patch.hunks);
  if (!patch.to && nextContent !== "") {
    throw new LocalLlmToolError("A deleted file patch must remove all file content.");
  }
  if (patch.to) {
    await assertWritableTarget(root, targetPath);
  }
  return {
    additions: patch.additions,
    deletions: patch.deletions,
    nextContent: patch.to ? nextContent : null,
    path: targetPath,
    previousContent,
    relativePath
  };
}

export async function applyLocalLlmUnifiedDiff(
  root: string,
  patch: string,
  limits: Pick<LocalLlmToolExecutorLimits, "maxDiffBytes" | "maxFilesPerDiff">
    & Partial<Pick<LocalLlmToolExecutorLimits, "maxPatchSourceBytes">>,
  operations: LocalLlmUnifiedDiffCommitOperations = defaultLocalLlmUnifiedDiffCommitOperations
) {
  const canonicalRoot = await realpath(root);
  return withLocalLlmWorkspacePatchLock(canonicalRoot, async () => {
    await recoverLocalLlmUnifiedDiffTransactions(canonicalRoot, operations);
    if (!patch.trim() || Buffer.byteLength(patch, "utf8") > limits.maxDiffBytes) {
      throw new LocalLlmToolError("Patch is empty or exceeds the configured size limit.");
    }
    const filePatches = parseUnifiedDiff(patch);
    if (filePatches.length === 0 || filePatches.length > limits.maxFilesPerDiff) {
      throw new LocalLlmToolError("Patch must contain at least one and no more than the allowed number of file changes.");
    }

    // Complete every validation and stale-context check before the durable
    // rollback journal writes its first target mutation.
    const planned = await Promise.all(
      filePatches.map((filePatch) => planFilePatch(
        canonicalRoot,
        filePatch,
        Math.max(1, Math.min(
          limits.maxPatchSourceBytes ?? MAX_LOCAL_LLM_PATCH_BACKUP_BYTES,
          MAX_LOCAL_LLM_PATCH_BACKUP_BYTES
        ))
      ))
    );
    await commitLocalLlmUnifiedDiffPlans(canonicalRoot, planned, operations);
    return {
      files: planned.map((entry) => ({
        additions: entry.additions,
        deletions: entry.deletions,
        path: entry.relativePath,
        status: entry.nextContent === null ? "deleted" : entry.previousContent === null ? "created" : "modified"
      }))
    };
  });
}
