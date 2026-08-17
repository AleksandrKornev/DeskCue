import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { collectBoundedWorkspaceEvidence } from "./workspaceFilesystemEvidence.ts";
import {
  captureLocalLlmWorkspaceGitBaseline,
  completeLocalLlmWorkspaceGitChangeSet
} from "./workspaceGitChangeSet.ts";

const execFileAsync = promisify(execFile);

test("workspace evidence applies its aggregate byte cap while materializing", async () => {
  const allocations: number[] = [];
  const evidence = await collectBoundedWorkspaceEvidence(
    Array.from({ length: 10 }, (_, index) => async (maxOutputBytes: number) => {
      allocations[index] = maxOutputBytes;
      return String(index).repeat(maxOutputBytes);
    }),
    { concurrency: 2, maxItemBytes: 4, maxTotalBytes: 10 }
  );

  assert.equal(Buffer.byteLength(evidence), 9);
  assert.equal(evidence, "0000\n1111");
  assert.deepEqual(allocations, [4, 4]);
});

test("workspace evidence retains input order across concurrent materialization", async () => {
  const evidence = await collectBoundedWorkspaceEvidence(
    [
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "first";
      },
      async () => "second",
      async () => "third"
    ],
    { concurrency: 2, maxItemBytes: 16, maxTotalBytes: 64 }
  );

  assert.equal(evidence, "first\nsecond\nthird");
});

test("local LLM filesystem snapshot captures non-git text changes without reading ignored directories", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-local-llm-no-git-"));
  try {
    await writeFile(join(cwd, "before.txt"), "before\n", "utf8");
    await mkdir(join(cwd, "node_modules"));
    await writeFile(join(cwd, "node_modules", "ignored.txt"), "before\n", "utf8");
    const baseline = await captureLocalLlmWorkspaceGitBaseline(cwd);
    await writeFile(join(cwd, "before.txt"), "after\n", "utf8");
    await writeFile(join(cwd, "created.txt"), "created\n", "utf8");
    await writeFile(join(cwd, "node_modules", "ignored.txt"), "after\n", "utf8");
    const changeSet = await completeLocalLlmWorkspaceGitChangeSet(baseline);

    assert.equal(baseline.kind, "filesystem");
    assert.equal(changeSet.kind, "filesystem_change_set");
    assert.deepEqual(changeSet.changedFiles, ["before.txt", "created.txt"]);
    const diff = changeSet.finalSnapshot?.diff ?? "";
    assert.match(diff, /diff --git a\/before\.txt b\/before\.txt/);
    assert.match(diff, /@@ -1 \+1 @@/);
    assert.match(diff, /-before/);
    assert.match(diff, /\+after/);
    assert.match(diff, /diff --git a\/created\.txt b\/created\.txt/);
    assert.doesNotMatch(diff, /ignored\.txt/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("local LLM filesystem evidence stops at its directory budget", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-local-llm-directory-cap-"));
  try {
    await Promise.all(Array.from({ length: 520 }, (_, index) =>
      mkdir(join(cwd, `directory-${String(index).padStart(3, "0")}`))
    ));

    const baseline = await captureLocalLlmWorkspaceGitBaseline(cwd);

    assert.equal(baseline.kind, "filesystem");
    if (baseline.kind !== "filesystem") return;
    assert.equal(baseline.truncated, true);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("local LLM filesystem evidence omits oversized files without loading their content", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-local-llm-file-cap-"));
  try {
    await writeFile(join(cwd, "oversized.bin"), Buffer.alloc(512 * 1024 + 1, 1));

    const baseline = await captureLocalLlmWorkspaceGitBaseline(cwd);

    assert.equal(baseline.kind, "filesystem");
    if (baseline.kind !== "filesystem") return;
    assert.equal(baseline.fileStates["oversized.bin"]?.kind, "omitted");
    assert.equal(baseline.fileStates["oversized.bin"]?.content, null);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

async function createGitWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-local-llm-git-"));
  await execFileAsync("git", ["init"], { cwd });
  await execFileAsync("git", ["config", "user.email", "deskcue-test@example.test"], { cwd });
  await execFileAsync("git", ["config", "user.name", "DeskCue test"], { cwd });
  await writeFile(join(cwd, "changed-during-turn.txt"), "committed\n", "utf8");
  await writeFile(join(cwd, "already-dirty.txt"), "committed\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd });
  return cwd;
}

test("local LLM git change set excludes old dirty files that stayed unchanged", async () => {
  const cwd = await createGitWorkspace();
  try {
    await writeFile(join(cwd, "already-dirty.txt"), "old dirty state\n", "utf8");
    const baseline = await captureLocalLlmWorkspaceGitBaseline(cwd);

    await writeFile(join(cwd, "changed-during-turn.txt"), "new work\n", "utf8");
    await writeFile(join(cwd, "new-during-turn.txt"), "created during the turn\n", "utf8");

    const changeSet = await completeLocalLlmWorkspaceGitChangeSet(baseline);

    assert.equal(changeSet.kind, "git_change_set");
    assert.equal(changeSet.attribution, "workspace_state_observed_between_snapshots");
    assert.deepEqual(changeSet.changedFiles, ["changed-during-turn.txt", "new-during-turn.txt"]);
    assert.match(changeSet.finalSnapshot?.diff ?? "", /new-during-turn\.txt/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("local LLM git change set notices a new hunk in an already dirty file", async () => {
  const cwd = await createGitWorkspace();
  try {
    await writeFile(join(cwd, "already-dirty.txt"), "before turn\n", "utf8");
    const baseline = await captureLocalLlmWorkspaceGitBaseline(cwd);

    await writeFile(join(cwd, "already-dirty.txt"), "after turn\n", "utf8");
    const changeSet = await completeLocalLlmWorkspaceGitChangeSet(baseline);

    assert.equal(changeSet.kind, "git_change_set");
    assert.deepEqual(changeSet.changedFiles, ["already-dirty.txt"]);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("local LLM git evidence fingerprints oversized dirty files without materializing a diff", async () => {
  const cwd = await createGitWorkspace();
  try {
    const largeFile = join(cwd, "oversized.bin");
    await writeFile(largeFile, Buffer.alloc(8 * 1024 * 1024 + 1, 1));
    const baseline = await captureLocalLlmWorkspaceGitBaseline(cwd);

    assert.equal(baseline.kind, "git");
    if (baseline.kind !== "git") return;
    assert.match(baseline.fileStates["oversized.bin"]?.contentHash ?? "", /^metadata:/);

    await writeFile(largeFile, Buffer.alloc(8 * 1024 * 1024 + 2, 2));
    const changeSet = await completeLocalLlmWorkspaceGitChangeSet(baseline);

    assert.equal(changeSet.kind, "git_change_set");
    assert.ok(changeSet.changedFiles.includes("oversized.bin"));
    assert.doesNotMatch(changeSet.finalSnapshot?.diff ?? "", /oversized\.bin/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});
