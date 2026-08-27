import { execFile } from "node:child_process";
import { lstat, open, readlink } from "node:fs/promises";
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
const gitUtf8PathArguments = ["-c", "core.quotePath=false"];
const gitStableDiffPathArguments = ["--src-prefix=a/", "--dst-prefix=b/"];

type GitCommandError = Error & {
  code?: unknown;
  stdout?: unknown;
};

type TrackedGitDiff = {
  text: string;
  wasTruncated: boolean;
};

type SyntheticGitDiff = TrackedGitDiff;

type SyntheticDiffFile = {
  file: string;
  indexedMode?: string;
};

type GitWorktreeModeTrust = {
  fileMode: boolean;
  symlinks: boolean;
};

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

function gitHeadExists(cwd: string) {
  return runGit(cwd, ["rev-parse", "--verify", "HEAD"]).then(
    () => true,
    () => false
  );
}

function recoverBufferedGitDiff(error: unknown): TrackedGitDiff {
  const commandError = error as GitCommandError;

  if (commandError?.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return { text: "", wasTruncated: false };

  return {
    text: typeof commandError.stdout === "string" ? commandError.stdout : "",
    wasTruncated: true
  };
}

function readTrackedWorkspaceDiff(cwd: string) {
  // Compare the whole working tree with HEAD so staged and unstaged edits are
  // represented by one final patch per path. Plain `git diff` omits staged
  // changes even though `git status` reports them as dirty.
  return runGit(
    cwd,
    [
      ...gitUtf8PathArguments,
      "diff",
      "--no-ext-diff",
      ...gitStableDiffPathArguments,
      "--unified=3",
      "HEAD"
    ],
    { maxBuffer: maxGitDiffBytes }
  ).then(
    (text): TrackedGitDiff => ({ text, wasTruncated: false }),
    recoverBufferedGitDiff
  );
}

function parseIndexedFileModes(output: string) {
  const records = output.split("\0");
  const modes = new Map<string, string>();

  for (let index = 0; index < records.length - 1; index += 1) {
    const match = /^:\d{6} (\d{6}) [0-9a-f]+ [0-9a-f]+ A$/.exec(records[index] ?? "");

    if (!match) continue;

    const file = records[index + 1];

    if (file) modes.set(file, match[1]);
    index += 1;
  }

  return modes;
}

function readUnbornIndexedFileModes(cwd: string) {
  return runGit(cwd, ["diff", "--cached", "--raw", "--no-abbrev", "-z"], {
    maxBuffer: maxGitStatusBytes
  }).then(parseIndexedFileModes, () => new Map<string, string>());
}

async function readGitWorktreeModeTrust(cwd: string): Promise<GitWorktreeModeTrust> {
  const [fileMode, symlinks] = await Promise.all([
    runGit(cwd, ["config", "--bool", "core.filemode"]).catch(() => "true"),
    runGit(cwd, ["config", "--bool", "core.symlinks"]).catch(() => "true")
  ]);

  return {
    fileMode: fileMode !== "false",
    symlinks: symlinks !== "false"
  };
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
  const previousPathEntries: Array<[string, string]> = [];
  const untrackedFiles: string[] = [];
  let isDirty = false;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (!record) continue;

    isDirty = true;
    const status = record.slice(0, 2);
    const filePath = record.slice(3);
    const previousPath = status.includes("R") || status.includes("C")
      ? records[index + 1]
      : undefined;

    if (filePath && changedFiles.length < maxChangedFiles) {
      changedFiles.push(filePath);
      statusEntries.push([filePath, mapPorcelainStatus(status)]);
      if (previousPath) previousPathEntries.push([filePath, previousPath]);
      if (status === "??") untrackedFiles.push(filePath);
    }

    if (status.includes("R") || status.includes("C")) index += 1;
  }

  return {
    changedFiles,
    changedFilePreviousPaths: Object.fromEntries(previousPathEntries),
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

function quoteSyntheticGitPath(path: string) {
  if (!/[\u0000-\u001f"\\\u007f]/.test(path)) return path;

  let quoted = "\"";

  for (const character of path) {
    if (character === "\"") {
      quoted += "\\\"";
    } else if (character === "\\") {
      quoted += "\\\\";
    } else {
      const codePoint = character.codePointAt(0) ?? 0;

      if (codePoint <= 0x1f || codePoint === 0x7f) {
        quoted += [...Buffer.from(character)]
          .map((byte) => `\\${byte.toString(8).padStart(3, "0")}`)
          .join("");
      } else {
        quoted += character;
      }
    }
  }

  return `${quoted}\"`;
}

export function resolveSyntheticGitFileMode(
  isWorktreeSymlink: boolean,
  worktreeMode: number,
  indexedMode: string | undefined,
  modeTrust: GitWorktreeModeTrust
) {
  if (isWorktreeSymlink) return "120000";
  if (!modeTrust.symlinks && indexedMode === "120000") return "120000";

  const worktreeExecutable = (worktreeMode & 0o111) !== 0;

  if (modeTrust.fileMode) return worktreeExecutable ? "100755" : "100644";
  if (indexedMode === "100644" || indexedMode === "100755") return indexedMode;

  return worktreeExecutable ? "100755" : "100644";
}

async function buildSyntheticFileDiff(
  cwd: string,
  { file, indexedMode }: SyntheticDiffFile,
  modeTrust: GitWorktreeModeTrust
) {
  const absolutePath = resolve(cwd, file);
  const workspaceRoot = resolve(cwd);

  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${sep}`)) return "";

  let fileStat;
  try {
    fileStat = await lstat(absolutePath);
  } catch {
    return "";
  }

  if (indexedMode === "160000") return "";
  if (!fileStat.isFile() && !fileStat.isSymbolicLink()) return "";
  if (fileStat.size > maxSyntheticDiffFileBytes) return "";

  const isWorktreeSymlink = fileStat.isSymbolicLink();
  const fileMode = resolveSyntheticGitFileMode(
    isWorktreeSymlink,
    fileStat.mode,
    indexedMode,
    modeTrust
  );

  if (isWorktreeSymlink && fileMode !== "120000") return "";

  const read = isWorktreeSymlink
    ? { bytes: Buffer.from(await readlink(absolutePath)), overflow: false }
    : await readBoundedFile(absolutePath, maxSyntheticDiffFileBytes);

  if (read.overflow) return "";

  const bytes = read.bytes;
  const oldPath = quoteSyntheticGitPath(`a/${file}`);
  const newPath = quoteSyntheticGitPath(`b/${file}`);

  if (bytes.includes(0)) {
    return [
      `diff --git ${oldPath} ${newPath}`,
      `new file mode ${fileMode}`,
      `--- /dev/null`,
      `+++ ${newPath}`,
      `Binary files /dev/null and ${newPath} differ`
    ].join("\n");
  }

  const text = bytes.toString("utf8");
  const lines = text.length ? text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n") : [];

  if (lines.at(-1) === "") lines.pop();

  return [
    `diff --git ${oldPath} ${newPath}`,
    `new file mode ${fileMode}`,
    "--- /dev/null",
    `+++ ${newPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`)
  ].join("\n");
}

async function buildSyntheticFilesDiff(
  cwd: string,
  files: SyntheticDiffFile[],
  modeTrust: GitWorktreeModeTrust
): Promise<SyntheticGitDiff> {
  const diffs = await mapWithConcurrency(
    files.slice(0, maxSyntheticDiffFiles),
    syntheticDiffConcurrency,
    (file) => buildSyntheticFileDiff(cwd, file, modeTrust)
  );
  const retained: string[] = [];
  let retainedBytes = 0;
  let wasTruncated = files.length > maxSyntheticDiffFiles;

  for (const diff of diffs) {
    if (!diff) continue;

    const diffBytes = Buffer.byteLength(diff);

    if (retainedBytes + diffBytes > maxSyntheticDiffTotalBytes) {
      wasTruncated = true;
      break;
    }

    retained.push(diff);
    retainedBytes += diffBytes;
  }

  return { text: retained.join("\n"), wasTruncated };
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
  const [statusOutput, headExists] = await Promise.all([
    runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    includeDiff ? gitHeadExists(cwd) : Promise.resolve(false)
  ]);
  const trackedDiffRead = headExists
    ? readTrackedWorkspaceDiff(cwd)
    : Promise.resolve<TrackedGitDiff>({ text: "", wasTruncated: false });

  const {
    changedFiles,
    changedFilePreviousPaths,
    changedFileStatuses,
    untrackedFiles,
    isDirty
  } = parseBoundedGitStatus(statusOutput);
  const [indexedFileModes, modeTrust] = await Promise.all([
    headExists || !includeDiff
      ? Promise.resolve(new Map<string, string>())
      : readUnbornIndexedFileModes(cwd),
    includeDiff
      ? readGitWorktreeModeTrust(cwd)
      : Promise.resolve({ fileMode: true, symlinks: true })
  ]);
  const syntheticDiffFiles = (headExists ? untrackedFiles : changedFiles).map((file) => ({
    file,
    indexedMode: indexedFileModes.get(file)
  }));
  const [trackedDiff, syntheticDiff] = await Promise.all([
    trackedDiffRead,
    includeDiff
      ? buildSyntheticFilesDiff(cwd, syntheticDiffFiles, modeTrust)
      : Promise.resolve<SyntheticGitDiff>({ text: "", wasTruncated: false })
  ]);
  const combinedDiff = [trackedDiff.text, syntheticDiff.text].filter(Boolean).join("\n");
  const diff = truncateUtf8(combinedDiff, maxGitDiffBytes);
  const diffTruncated = trackedDiff.wasTruncated ||
    syntheticDiff.wasTruncated ||
    Buffer.byteLength(combinedDiff) > maxGitDiffBytes;

  return {
    isGitRepo: true,
    branch: repo.branch,
    isDirty,
    changedFiles,
    ...(Object.keys(changedFilePreviousPaths).length > 0 ? { changedFilePreviousPaths } : {}),
    changedFileStatuses,
    diff,
    ...(diffTruncated ? { diffTruncated } : {}),
    lastUpdatedAt: new Date().toISOString()
  };
}
