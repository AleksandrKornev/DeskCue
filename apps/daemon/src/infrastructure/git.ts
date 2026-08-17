import { execFile } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { GitFileStatus, GitSnapshot } from "@deskcue/protocol";

const execFileAsync = promisify(execFile);
const maxSyntheticDiffFileBytes = 256 * 1024;
const maxChangedFiles = 2_000;
const maxGitStatusBytes = 4 * 1024 * 1024;
const maxGitDiffBytes = 4 * 1024 * 1024;
const maxSyntheticDiffFiles = 128;
const maxSyntheticDiffTotalBytes = 2 * 1024 * 1024;
const gitCommandTimeoutMs = 10_000;
const syntheticDiffConcurrency = 4;

export type BuildGitSnapshotOptions = {
  includeDiff?: boolean;
};

async function runGit(
  cwd: string,
  args: string[],
  options: { maxBuffer?: number; timeoutMs?: number } = {}
) {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: options.maxBuffer ?? maxGitStatusBytes,
    timeout: options.timeoutMs ?? gitCommandTimeoutMs
  });

  return result.stdout.trimEnd();
}

export async function inspectGitRepo(cwd: string) {
  try {
    const inside = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    if (inside.trim() !== "true") {
      return {
        isGitRepo: false,
        branch: null
      };
    }

    const branch = await runGit(cwd, ["branch", "--show-current"]).catch(() => "");

    return {
      isGitRepo: true,
      branch: branch || null
    };
  } catch {
    return {
      isGitRepo: false,
      branch: null
    };
  }
}

async function readTrackedWorkspaceDiff(cwd: string) {
  const diffOptions = {
    maxBuffer: maxGitDiffBytes
  };

  // Compare the whole working tree with HEAD so staged and unstaged edits are
  // represented by one final patch per path. Plain `git diff` omits staged
  // changes even though `git status` reports them as dirty.
  const headExists = await runGit(cwd, ["rev-parse", "--verify", "HEAD"]).then(
    () => true,
    () => false
  );
  if (headExists) {
    return runGit(cwd, ["diff", "--no-ext-diff", "--unified=3", "HEAD"], diffOptions)
      .catch(() => "");
  }

  const [indexed, workingTree] = await Promise.all([
    runGit(cwd, ["diff", "--cached", "--no-ext-diff", "--unified=3"], diffOptions).catch(() => ""),
    runGit(cwd, ["diff", "--no-ext-diff", "--unified=3"], diffOptions).catch(() => "")
  ]);
  return [indexed, workingTree].filter(Boolean).join("\n");
}

export async function buildGitIdentitySnapshot(cwd: string): Promise<GitSnapshot> {
  const repo = await inspectGitRepo(cwd);

  return {
    isGitRepo: repo.isGitRepo,
    branch: repo.branch,
    isDirty: false,
    changedFiles: [],
    changedFileStatuses: {},
    diff: "",
    lastUpdatedAt: new Date().toISOString()
  };
}

const unmergedGitStatuses = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const gitFileStatusPriority: readonly GitFileStatus[] = ["U", "?", "D", "R", "C", "A", "M"];

function mapPorcelainStatus(status: string): GitFileStatus {
  if (status === "??") return "?";
  if (unmergedGitStatuses.has(status) || status.includes("U")) return "U";

  const candidates = new Set<GitFileStatus>();
  for (const value of status) {
    if (value === "M" || value === "A" || value === "D" || value === "R" || value === "C") {
      candidates.add(value);
    } else if (value === "T") {
      candidates.add("M");
    }
  }
  return gitFileStatusPriority.find((candidate) => candidates.has(candidate)) ?? "?";
}

export function parseBoundedGitStatus(output: string) {
  const records = output.split("\0");
  const changedFiles: string[] = [];
  const statusEntries: Array<[string, GitFileStatus]> = [];
  const untrackedFiles: string[] = [];
  let isDirty = false;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    isDirty = true;
    const status = record.slice(0, 2);
    const filePath = record.slice(3);
    if (filePath && changedFiles.length < maxChangedFiles) {
      changedFiles.push(filePath);
      statusEntries.push([filePath, mapPorcelainStatus(status)]);
      if (status === "??") untrackedFiles.push(filePath);
    }
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return {
    changedFiles,
    changedFileStatuses: Object.fromEntries(statusEntries),
    isDirty,
    untrackedFiles
  };
}

function truncateUtf8(value: string, maxBytes: number) {
  const bytes = Buffer.from(value);
  if (bytes.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

async function mapWithConcurrency<TInput, TResult>(
  values: readonly TInput[],
  concurrency: number,
  read: (value: TInput) => Promise<TResult>
) {
  const results = new Array<TResult>(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await read(values[index]);
    }
  }));
  return results;
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

async function buildUntrackedFileDiff(cwd: string, file: string) {
  const absolutePath = resolve(cwd, file);
  const workspaceRoot = resolve(cwd);
  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${sep}`)) {
    return "";
  }

  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch {
    return "";
  }

  if (!fileStat.isFile() || fileStat.size > maxSyntheticDiffFileBytes) {
    return "";
  }

  const read = await readBoundedFile(absolutePath, maxSyntheticDiffFileBytes);
  if (read.overflow) return "";
  const bytes = read.bytes;
  if (bytes.includes(0)) {
    return [
      `diff --git a/${file} b/${file}`,
      "new file mode 100644",
      `--- /dev/null`,
      `+++ b/${file}`,
      "Binary files /dev/null and b/" + file + " differ"
    ].join("\n");
  }

  const text = bytes.toString("utf8");
  const lines = text.length ? text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n") : [];
  if (lines.at(-1) === "") {
    lines.pop();
  }

  return [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`)
  ].join("\n");
}

async function buildUntrackedFilesDiff(cwd: string, files: string[]) {
  const diffs = await mapWithConcurrency(
    files.slice(0, maxSyntheticDiffFiles),
    syntheticDiffConcurrency,
    (file) => buildUntrackedFileDiff(cwd, file)
  );
  const retained: string[] = [];
  let retainedBytes = 0;
  for (const diff of diffs) {
    if (!diff) continue;
    const diffBytes = Buffer.byteLength(diff);
    if (retainedBytes + diffBytes > maxSyntheticDiffTotalBytes) break;
    retained.push(diff);
    retainedBytes += diffBytes;
  }
  return retained.join("\n");
}

export async function buildGitSnapshot(
  cwd: string,
  options: BuildGitSnapshotOptions = {}
): Promise<GitSnapshot> {
  const repo = await inspectGitRepo(cwd);
  if (!repo.isGitRepo) {
    return {
      isGitRepo: false,
      branch: null,
      isDirty: false,
      changedFiles: [],
      changedFileStatuses: {},
      diff: "",
      lastUpdatedAt: new Date().toISOString()
    };
  }

  const includeDiff = options.includeDiff ?? true;
  const [statusOutput, trackedDiffOutput] = await Promise.all([
    runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    includeDiff
      ? readTrackedWorkspaceDiff(cwd)
      : Promise.resolve("")
  ]);

  const {
    changedFiles,
    changedFileStatuses,
    untrackedFiles,
    isDirty
  } = parseBoundedGitStatus(statusOutput);
  const untrackedDiffOutput = includeDiff ? await buildUntrackedFilesDiff(cwd, untrackedFiles) : "";
  const diff = truncateUtf8(
    [trackedDiffOutput, untrackedDiffOutput].filter(Boolean).join("\n"),
    maxGitDiffBytes
  );

  return {
    isGitRepo: true,
    branch: repo.branch,
    isDirty,
    changedFiles,
    changedFileStatuses,
    diff,
    lastUpdatedAt: new Date().toISOString()
  };
}
