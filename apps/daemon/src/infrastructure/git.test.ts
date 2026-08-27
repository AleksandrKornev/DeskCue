import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildGitSnapshot,
  parseBoundedGitStatus,
  resolveSyntheticGitFileMode
} from "./git.ts";

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

test("buildGitSnapshot keeps tracked Unicode paths aligned between status and diff", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-git-unicode-"));

  try {
    await execFileAsync("git", ["init"], { cwd });
    await writeFile(join(cwd, "данные.txt"), "before\n", "utf8");
    await updateIndexFromWorktree(cwd, "данные.txt");
    await execFileAsync("git", [
      "-c", "user.name=DeskCue Test",
      "-c", "user.email=deskcue@example.invalid",
      "commit", "-m", "initial"
    ], { cwd });

    await writeFile(join(cwd, "данные.txt"), "after\n", "utf8");
    await execFileAsync("git", ["config", "diff.noprefix", "true"], { cwd });

    const snapshot = await buildGitSnapshot(cwd);

    assert.deepEqual(snapshot.changedFiles, ["данные.txt"]);
    assert.deepEqual(snapshot.changedFileStatuses, { "данные.txt": "M" });
    assert.match(snapshot.diff, /diff --git a\/данные\.txt b\/данные\.txt/);
    assert.match(snapshot.diff, /-before/);
    assert.match(snapshot.diff, /\+after/);
    assert.doesNotMatch(snapshot.diff, /\\320\\264/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("buildGitSnapshot composes an unborn staged and unstaged file as one final addition", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-git-unborn-mixed-"));

  try {
    await execFileAsync("git", ["init"], { cwd });
    await writeFile(join(cwd, "данные.txt"), "staged\n", "utf8");
    await updateIndexFromWorktree(cwd, "данные.txt");
    await execFileAsync("git", ["update-index", "--chmod=+x", "данные.txt"], { cwd });
    await writeFile(join(cwd, "данные.txt"), "final\n", "utf8");

    const snapshot = await buildGitSnapshot(cwd);

    assert.deepEqual(snapshot.changedFiles, ["данные.txt"]);
    assert.deepEqual(snapshot.changedFileStatuses, { "данные.txt": "A" });
    assert.equal(snapshot.diff.match(/^diff --git /gm)?.length, 1);
    assert.match(snapshot.diff, /new file mode 100755/);
    assert.match(snapshot.diff, /\+final/);
    assert.doesNotMatch(snapshot.diff, /staged/);

    await execFileAsync("git", ["config", "core.filemode", "true"], { cwd });

    const trustedWorktreeSnapshot = await buildGitSnapshot(cwd);

    assert.match(trustedWorktreeSnapshot.diff, /new file mode 100644/);
    assert.doesNotMatch(trustedWorktreeSnapshot.diff, /new file mode 100755/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("buildGitSnapshot does not retain an indexed symlink mode for a trusted regular file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-git-unborn-symlink-mode-"));

  try {
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["config", "core.symlinks", "true"], { cwd });
    await writeFile(join(cwd, "link.txt"), "target", "utf8");
    const { stdout: objectId } = await execFileAsync("git", ["hash-object", "-w", "link.txt"], {
      cwd
    });

    await execFileAsync("git", [
      "update-index",
      "--add",
      "--cacheinfo",
      `120000,${objectId.trim()},link.txt`
    ], { cwd });
    await writeFile(join(cwd, "link.txt"), "regular-final", "utf8");

    const snapshot = await buildGitSnapshot(cwd);

    assert.match(snapshot.diff, /new file mode 100644/);
    assert.doesNotMatch(snapshot.diff, /new file mode 120000/);
    assert.match(snapshot.diff, /\+regular-final/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("buildGitSnapshot preserves an actual symlink when Git checkout symlinks are disabled", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-git-untracked-symlink-"));

  try {
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["config", "core.symlinks", "false"], { cwd });
    await writeFile(join(cwd, "target.txt"), "target content", "utf8");
    await symlink("target.txt", join(cwd, "link.txt"), "file");

    const snapshot = await buildGitSnapshot(cwd);
    const linkDiff = snapshot.diff.split("diff --git a/target.txt")[0];

    assert.match(linkDiff, /diff --git a\/link\.txt b\/link\.txt/);
    assert.match(linkDiff, /new file mode 120000/);
    assert.match(linkDiff, /\+target\.txt/);
    assert.doesNotMatch(linkDiff, /target content/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("synthetic mode preserves either indexed regular mode when filemode is untrusted", () => {
  const modeTrust = { fileMode: false, symlinks: true };

  assert.equal(resolveSyntheticGitFileMode(false, 0o755, "100644", modeTrust), "100644");
  assert.equal(resolveSyntheticGitFileMode(false, 0o644, "100755", modeTrust), "100755");
  assert.equal(resolveSyntheticGitFileMode(false, 0o755, undefined, modeTrust), "100755");
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
