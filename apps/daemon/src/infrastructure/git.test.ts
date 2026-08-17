import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { buildGitSnapshot, parseBoundedGitStatus } from "./git.ts";

const execFileAsync = promisify(execFile);

test("buildGitSnapshot includes synthetic diff for untracked text files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-git-"));
  try {
    await execFileAsync("git", ["init"], { cwd });
    await writeFile(join(cwd, "new-file.txt"), "first line\nsecond line\n", "utf8");

    const snapshot = await buildGitSnapshot(cwd);

    assert.equal(snapshot.isGitRepo, true);
    assert.equal(snapshot.isDirty, true);
    assert.deepEqual(snapshot.changedFiles, ["new-file.txt"]);
    assert.deepEqual(snapshot.changedFileStatuses, { "new-file.txt": "?" });
    assert.match(snapshot.diff, /diff --git a\/new-file\.txt b\/new-file\.txt/);
    assert.match(snapshot.diff, /\+\+\+ b\/new-file\.txt/);
    assert.match(snapshot.diff, /\+first line/);
    assert.match(snapshot.diff, /\+second line/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("buildGitSnapshot can skip diff for summary refreshes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-git-summary-"));
  try {
    await execFileAsync("git", ["init"], { cwd });
    await writeFile(join(cwd, "new-file.txt"), "first line\nsecond line\n", "utf8");

    const snapshot = await buildGitSnapshot(cwd, {
      includeDiff: false
    });

    assert.equal(snapshot.isGitRepo, true);
    assert.equal(snapshot.isDirty, true);
    assert.deepEqual(snapshot.changedFiles, ["new-file.txt"]);
    assert.equal(snapshot.diff, "");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("buildGitSnapshot treats missing git executable as a non-git workspace", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-no-git-workspace-"));
  const pathWithoutGit = await mkdtemp(join(tmpdir(), "deskcue-no-git-path-"));

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { buildGitSnapshot } from './src/infrastructure/git.ts';",
          `const snapshot = await buildGitSnapshot(${JSON.stringify(cwd)});`,
          "console.log(JSON.stringify(snapshot));"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: pathWithoutGit,
          Path: pathWithoutGit
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const snapshot = JSON.parse(result.stdout.trim()) as {
      branch: string | null;
      changedFiles: string[];
      diff: string;
      isDirty: boolean;
      isGitRepo: boolean;
    };

    assert.equal(snapshot.isGitRepo, false);
    assert.equal(snapshot.branch, null);
    assert.equal(snapshot.isDirty, false);
    assert.deepEqual(snapshot.changedFiles, []);
    assert.equal(snapshot.diff, "");
  } finally {
    await rm(cwd, { force: true, recursive: true });
    await rm(pathWithoutGit, { force: true, recursive: true });
  }
});

async function updateIndexFromWorktree(cwd: string, filePath: string) {
  const { stdout } = await execFileAsync("git", ["hash-object", "-w", filePath], { cwd });
  await execFileAsync("git", [
    "update-index",
    "--add",
    "--cacheinfo",
    `100644,${stdout.trim()},${filePath}`
  ], { cwd });
}

test("buildGitSnapshot includes staged changes in the workspace diff", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-git-staged-"));
  try {
    await execFileAsync("git", ["init"], { cwd });
    await writeFile(join(cwd, "tracked.txt"), "before\n", "utf8");
    await updateIndexFromWorktree(cwd, "tracked.txt");
    await execFileAsync("git", [
      "-c", "user.name=DeskCue Test",
      "-c", "user.email=deskcue@example.invalid",
      "commit", "-m", "initial"
    ], { cwd });

    await writeFile(join(cwd, "tracked.txt"), "after\nsecond line\n", "utf8");
    await updateIndexFromWorktree(cwd, "tracked.txt");

    const snapshot = await buildGitSnapshot(cwd);

    assert.deepEqual(snapshot.changedFiles, ["tracked.txt"]);
    assert.deepEqual(snapshot.changedFileStatuses, { "tracked.txt": "M" });
    assert.match(snapshot.diff, /diff --git a\/tracked\.txt b\/tracked\.txt/);
    assert.match(snapshot.diff, /-before/);
    assert.match(snapshot.diff, /\+after/);
    assert.match(snapshot.diff, /\+second line/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("parseBoundedGitStatus maps index and worktree states with stable priority", () => {
  const result = parseBoundedGitStatus([
    "M  staged.txt",
    " M unstaged.txt",
    "MM mixed.txt",
    "A  added.txt",
    " D deleted.txt",
    "R  renamed.txt",
    "old-name.txt",
    "C  copied.txt",
    "source.txt",
    "UU conflicted.txt",
    "?? untracked.txt",
    "T  type-changed.txt"
  ].join("\0"));

  assert.deepEqual(result.changedFiles, [
    "staged.txt",
    "unstaged.txt",
    "mixed.txt",
    "added.txt",
    "deleted.txt",
    "renamed.txt",
    "copied.txt",
    "conflicted.txt",
    "untracked.txt",
    "type-changed.txt"
  ]);
  assert.deepEqual(result.changedFileStatuses, {
    "staged.txt": "M",
    "unstaged.txt": "M",
    "mixed.txt": "M",
    "added.txt": "A",
    "deleted.txt": "D",
    "renamed.txt": "R",
    "copied.txt": "C",
    "conflicted.txt": "U",
    "untracked.txt": "?",
    "type-changed.txt": "M"
  });
});

test("buildGitSnapshot distinguishes unstaged, mixed, staged-added and untracked files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-git-statuses-"));
  try {
    await execFileAsync("git", ["init"], { cwd });
    await writeFile(join(cwd, "unstaged.txt"), "before\n", "utf8");
    await writeFile(join(cwd, "mixed.txt"), "before\n", "utf8");
    await updateIndexFromWorktree(cwd, "unstaged.txt");
    await updateIndexFromWorktree(cwd, "mixed.txt");
    await execFileAsync("git", [
      "-c", "user.name=DeskCue Test",
      "-c", "user.email=deskcue@example.invalid",
      "commit", "-m", "initial"
    ], { cwd });

    await writeFile(join(cwd, "unstaged.txt"), "worktree\n", "utf8");
    await writeFile(join(cwd, "mixed.txt"), "staged\n", "utf8");
    await updateIndexFromWorktree(cwd, "mixed.txt");
    await writeFile(join(cwd, "mixed.txt"), "worktree after staged\n", "utf8");
    await writeFile(join(cwd, "staged-added.txt"), "staged\n", "utf8");
    await updateIndexFromWorktree(cwd, "staged-added.txt");
    await writeFile(join(cwd, "untracked.txt"), "untracked\n", "utf8");

    const snapshot = await buildGitSnapshot(cwd, { includeDiff: false });

    assert.deepEqual(snapshot.changedFileStatuses, {
      "mixed.txt": "M",
      "staged-added.txt": "A",
      "unstaged.txt": "M",
      "untracked.txt": "?"
    });
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});
