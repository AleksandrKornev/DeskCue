import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { GitSnapshot } from "@deskcue/protocol";
import { buildGitSnapshot, inspectGitRepo } from "#infrastructure/git";
import {
  buildObservedWorkspaceFilesystemDiff,
  buildWorkspaceFilesystemFileDiff,
  captureWorkspaceFilesystemSnapshot,
  collectBoundedWorkspaceEvidence,
  readWorkspaceFilesystemFileState,
  sameWorkspaceFilesystemFileState
} from "#localLlmChats/workspace/workspaceFilesystemEvidence";
import type { LocalLlmWorkspaceFilesystemFileState } from "#localLlmChats/workspace/workspaceFilesystemEvidence";

const execFileAsync = promisify(execFile);

/**
 * A baseline deliberately records only the workspace state DeskCue could
 * observe. It must not be presented as proof that a particular model authored
 * a file: another process can modify the same workspace during a turn.
 */
export type LocalLlmWorkspaceGitBaseline = {
  capturedAt: string;
  kind: "git";
  rootPath: string;
  snapshot: GitSnapshot;
  fileStates: Record<string, LocalLlmWorkspaceGitFileState>;
  truncated: boolean;
} | {
  capturedAt: string;
  kind: "filesystem";
  rootPath: string;
  fileStates: Record<string, LocalLlmWorkspaceFilesystemFileState>;
  truncated: boolean;
} | {
  capturedAt: string;
  kind: "unavailable";
  rootPath: string;
  reason?: string;
};

export type LocalLlmWorkspaceGitFileState = {
  contentHash: string | null;
  status: string;
};

export type LocalLlmWorkspaceGitChangeSet = {
  attribution: "workspace_state_observed_between_snapshots";
  baseline: LocalLlmWorkspaceGitBaseline;
  changedFiles: string[];
  completedAt: string;
  /**
   * This is the repository diff after the turn. It can include earlier dirty
   * hunks in a file that changed during the turn, so consumers must display
   * the attribution label together with it.
   */
  diffScope: "current_workspace_git_state" | "filesystem_snapshot";
  finalSnapshot: GitSnapshot | null;
  kind: "filesystem_change_set" | "git_change_set" | "unavailable";
};

const MAX_GIT_EVIDENCE_FILES = 2_000;
const MAX_GIT_HASH_FILE_BYTES = 8 * 1024 * 1024;
const MAX_GIT_DIFF_FILES = 256;
const MAX_GIT_DIFF_FILE_BYTES = 1024 * 1024;
const MAX_GIT_DIFF_TOTAL_BYTES = 8 * 1024 * 1024;
const GIT_EVIDENCE_CONCURRENCY = 8;
const GIT_EVIDENCE_DEADLINE_MS = 15_000;
const GIT_COMMAND_TIMEOUT_MS = 10_000;

function unavailableChangeSet(baseline: LocalLlmWorkspaceGitBaseline, completedAt: string): LocalLlmWorkspaceGitChangeSet {
  return {
    attribution: "workspace_state_observed_between_snapshots",
    baseline,
    changedFiles: [],
    completedAt,
    diffScope: "current_workspace_git_state",
    finalSnapshot: null,
    kind: "unavailable"
  };
}

async function buildUntrackedFileDiff(
  rootPath: string,
  filePath: string,
  deadline: number,
  maxOutputBytes: number
) {
  try {
    return await buildWorkspaceFilesystemFileDiff(
      filePath,
      undefined,
      await readWorkspaceFilesystemFileState(rootPath, filePath),
      deadline,
      maxOutputBytes
    );
  } catch {
    return "";
  }
}

async function buildObservedGitDiff(
  rootPath: string,
  changedFiles: readonly string[],
  finalStates: Record<string, LocalLlmWorkspaceGitFileState>,
  deadline: number
) {
  return collectBoundedWorkspaceEvidence(changedFiles.map((filePath) => async (maxOutputBytes) => {
    if (Date.now() >= deadline) return "";
    if (finalStates[filePath]?.status === "??") {
      return buildUntrackedFileDiff(rootPath, filePath, deadline, maxOutputBytes);
    }
    try {
      const { stdout } = await execFileAsync("git", ["diff", "--no-ext-diff", "--unified=3", "HEAD", "--", filePath], {
        cwd: rootPath,
        maxBuffer: maxOutputBytes,
        timeout: Math.max(1, Math.min(GIT_COMMAND_TIMEOUT_MS, deadline - Date.now()))
      });
      const diff = stdout.trimEnd();
      return Buffer.byteLength(diff) <= maxOutputBytes ? diff : "";
    } catch {
      return "";
    }
  }), {
    concurrency: GIT_EVIDENCE_CONCURRENCY,
    maxItemBytes: MAX_GIT_DIFF_FILE_BYTES,
    maxTotalBytes: MAX_GIT_DIFF_TOTAL_BYTES
  });
}

async function readGitFileStatuses(rootPath: string) {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: rootPath,
    maxBuffer: 4 * 1024 * 1024,
    timeout: GIT_COMMAND_TIMEOUT_MS
  });
  const records = stdout.split("\0");
  const statuses = new Map<string, string>();
  let truncated = false;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const filePath = record.slice(3);
    if (filePath) {
      if (statuses.size < MAX_GIT_EVIDENCE_FILES) statuses.set(filePath, status);
      else truncated = true;
    }
    if (status.includes("R") || status.includes("C")) {
      const originalPath = records[index + 1];
      if (originalPath) {
        if (statuses.size < MAX_GIT_EVIDENCE_FILES) {
          statuses.set(originalPath, `${status}:original`);
        } else {
          truncated = true;
        }
      }
      index += 1;
    }
  }
  return { statuses, truncated };
}

async function readBoundedFile(path: string, maxBytes: number) {
  const handle = await open(path, "r");
  const bytes = Buffer.allocUnsafe(maxBytes + 1);
  let offset = 0;
  try {
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
  } finally {
    await handle.close();
  }
  return {
    bytes: bytes.subarray(0, Math.min(offset, maxBytes)),
    overflow: offset > maxBytes
  };
}

async function hashWorkspaceFile(rootPath: string, filePath: string, deadline: number) {
  const absolutePath = resolve(rootPath, filePath);
  if (absolutePath !== rootPath && !absolutePath.startsWith(`${rootPath}${sep}`)) {
    return null;
  }
  try {
    const info = await lstat(absolutePath);
    if (!info.isFile()) return null;
    if (Date.now() >= deadline || info.size > MAX_GIT_HASH_FILE_BYTES) {
      return `metadata:${info.size}:${Math.trunc(info.mtimeMs)}`;
    }
    const read = await readBoundedFile(absolutePath, MAX_GIT_HASH_FILE_BYTES);
    if (read.overflow) return `metadata:${info.size}:${Math.trunc(info.mtimeMs)}`;
    return createHash("sha256").update(read.bytes).digest("hex");
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T>(factories: Array<() => Promise<T>>, limit: number) {
  const results = new Array<T>(factories.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(limit, factories.length) }, async () => {
    while (nextIndex < factories.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await factories[index]();
    }
  }));
  return results;
}

/**
 * Capture a lightweight, non-mutating baseline before a local-model turn.
 * For already dirty files we retain a content fingerprint, which lets the
 * final comparison omit old dirt that did not change during this turn.
 */
export async function captureLocalLlmWorkspaceGitBaseline(
  workspacePath: string
): Promise<LocalLlmWorkspaceGitBaseline> {
  const rootPath = resolve(workspacePath);
  const capturedAt = new Date().toISOString();
  const deadline = Date.now() + GIT_EVIDENCE_DEADLINE_MS;
  const repo = await inspectGitRepo(rootPath);
  if (!repo.isGitRepo) {
    try {
      const snapshot = await captureWorkspaceFilesystemSnapshot(rootPath);
      return { capturedAt, kind: "filesystem", rootPath, ...snapshot };
    } catch (error) {
      return {
        capturedAt,
        kind: "unavailable",
        rootPath,
        reason: error instanceof Error ? error.message : "Filesystem baseline could not be captured."
      };
    }
  }

  try {
    const [snapshot, statusResult] = await Promise.all([
      buildGitSnapshot(rootPath, { includeDiff: false }),
      readGitFileStatuses(rootPath)
    ]);
    const statuses = statusResult.statuses;
    const fileStates = Object.fromEntries(
      await mapWithConcurrency(
        [...statuses.entries()].map(([filePath, status]) => async () => [
          filePath,
          {
            contentHash: await hashWorkspaceFile(rootPath, filePath, deadline),
            status
          } satisfies LocalLlmWorkspaceGitFileState
        ] as const),
        GIT_EVIDENCE_CONCURRENCY
      )
    );
    return {
      capturedAt,
      kind: "git",
      rootPath,
      snapshot,
      fileStates,
      truncated: statusResult.truncated || Date.now() >= deadline
    };
  } catch (error) {
    return {
      capturedAt,
      kind: "unavailable",
      rootPath,
      reason: error instanceof Error ? error.message : "Git baseline could not be captured."
    };
  }
}

function sameFileState(
  left: LocalLlmWorkspaceGitFileState | undefined,
  right: LocalLlmWorkspaceGitFileState | undefined
) {
  return left?.status === right?.status && left?.contentHash === right?.contentHash;
}

/**
 * Produce the post-turn git view without modifying the workspace. The result
 * is intentionally conservative: it identifies files whose observed state
 * changed while the turn was running, but never attributes ownership to the
 * local model.
 */
export async function completeLocalLlmWorkspaceGitChangeSet(
  baseline: LocalLlmWorkspaceGitBaseline
): Promise<LocalLlmWorkspaceGitChangeSet> {
  const completedAt = new Date().toISOString();
  const deadline = Date.now() + GIT_EVIDENCE_DEADLINE_MS;
  if (baseline.kind === "filesystem") {
    try {
      const final = await captureWorkspaceFilesystemSnapshot(baseline.rootPath);
      const allFiles = new Set([...Object.keys(baseline.fileStates), ...Object.keys(final.fileStates)]);
      const changedFiles = [...allFiles]
        .filter((filePath) => !sameWorkspaceFilesystemFileState(baseline.fileStates[filePath], final.fileStates[filePath]))
        .sort((left, right) => left.localeCompare(right));
      return {
        attribution: "workspace_state_observed_between_snapshots",
        baseline,
        changedFiles,
        completedAt,
        diffScope: "filesystem_snapshot",
        finalSnapshot: {
          branch: null,
          changedFiles,
          diff: await buildObservedWorkspaceFilesystemDiff(baseline.fileStates, final.fileStates, changedFiles),
          isDirty: changedFiles.length > 0,
          isGitRepo: false,
          lastUpdatedAt: completedAt
        },
        kind: "filesystem_change_set"
      };
    } catch {
      return unavailableChangeSet(baseline, completedAt);
    }
  }
  if (baseline.kind !== "git") {
    return unavailableChangeSet(baseline, completedAt);
  }

  try {
    const [finalSnapshot, statusResult] = await Promise.all([
      buildGitSnapshot(baseline.rootPath, { includeDiff: false }),
      readGitFileStatuses(baseline.rootPath)
    ]);
    const statuses = statusResult.statuses;
    const finalStates = Object.fromEntries(
      await mapWithConcurrency(
        [...statuses.entries()].map(([filePath, status]) => async () => [
          filePath,
          {
            contentHash: await hashWorkspaceFile(baseline.rootPath, filePath, deadline),
            status
          } satisfies LocalLlmWorkspaceGitFileState
        ] as const),
        GIT_EVIDENCE_CONCURRENCY
      )
    );
    const allFiles = new Set([...Object.keys(baseline.fileStates), ...Object.keys(finalStates)]);
    const changedFiles = [...allFiles]
      .filter((filePath) => !sameFileState(baseline.fileStates[filePath], finalStates[filePath]))
      .sort((left, right) => left.localeCompare(right));
    const observedDiff = await buildObservedGitDiff(
      baseline.rootPath,
      changedFiles.slice(0, MAX_GIT_DIFF_FILES),
      finalStates,
      deadline
    );

    return {
      attribution: "workspace_state_observed_between_snapshots",
      baseline,
      changedFiles,
      completedAt,
      diffScope: "current_workspace_git_state",
      finalSnapshot: {
        ...finalSnapshot,
        changedFiles,
        diff: observedDiff
      },
      kind: "git_change_set"
    };
  } catch {
    return unavailableChangeSet(baseline, completedAt);
  }
}
