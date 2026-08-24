import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalLlmToolExecutor } from "./localLlmToolExecutor.ts";
import { applyLocalLlmUnifiedDiff } from "./localLlmUnifiedDiff.ts";
import type { LocalLlmUnifiedDiffCommitOperations } from "./localLlmUnifiedDiff.ts";
import { resolveLocalLlmWorkspaceRoot } from "./localLlmWorkspaceFilesystem.ts";

function runNodeFixture(script: string, args: string[]) {
  return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--conditions=deskcue-source", "--import", "tsx", "--input-type=module", "--eval", script, ...args],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
    );
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Crash fixture timed out. ${stderr}`));
    }, 10_000);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

async function withWorkspace(run: (workspacePath: string) => Promise<void>) {
  const workspacePath = await mkdtemp(path.join(tmpdir(), "deskcue-local-llm-executor-"));

  try {
    await run(workspacePath);
  } finally {
    await rm(workspacePath, { force: true, recursive: true });
  }
}

test("read-only executor reads and searches only within canonical workspace", async () => {
  await withWorkspace(async (workspacePath) => {
    await writeFile(path.join(workspacePath, "notes.txt"), "alpha\nbeta\n", "utf8");
    const executor = new LocalLlmToolExecutor();

    const read = await executor.execute({
      policy: "read_only",
      request: { id: "read-1", name: "read_workspace_file", path: "notes.txt" },
      turnId: "turn-1",
      workspacePath
    });

    assert.equal(read.status, "completed");
    assert.equal((read.result as { content: string }).content, "alpha\nbeta\n");

    const search = await executor.execute({
      policy: "read_only",
      request: { id: "search-1", name: "search_workspace_text", query: "beta" },
      turnId: "turn-1",
      workspacePath
    });

    assert.deepEqual(search.result, { matches: [{ line: 2, path: "notes.txt", text: "beta" }], truncated: false });

    const blocked = await executor.execute({
      policy: "read_only",
      request: { id: "outside", name: "read_workspace_file", path: "../outside.txt" },
      turnId: "turn-1",
      workspacePath
    });

    assert.equal(blocked.status, "failed");
    assert.match(blocked.error ?? "", /escapes the attached workspace/);
  });
});

test("canonical workspace boundary rejects traversal and symlink escapes for reads and writes", async (context) => {
  const outsidePath = await mkdtemp(path.join(tmpdir(), "deskcue-local-llm-outside-"));

  try {
    await writeFile(path.join(outsidePath, "secret.txt"), "outside\n", "utf8");
    await withWorkspace(async (workspacePath) => {
      try {
        await symlink(outsidePath, path.join(workspacePath, "escape"), process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
          context.skip("This Windows account cannot create a junction/symlink.");
          return;
        }

        throw error;
      }

      const executor = new LocalLlmToolExecutor();
      const readEscape = await executor.execute({
        policy: "read_only",
        request: { id: "read-link", name: "read_workspace_file", path: "escape/secret.txt" },
        turnId: "turn-boundary",
        workspacePath
      });

      assert.equal(readEscape.status, "failed");
      assert.match(readEscape.error ?? "", /escapes the attached workspace/);

      const patchEscape = await executor.execute({
        policy: "auto_workspace",
        request: {
          id: "patch-link",
          name: "apply_unified_diff",
          patch: "--- /dev/null\n+++ b/escape/new.txt\n@@ -0,0 +1 @@\n+blocked\n"
        },
        turnId: "turn-boundary",
        workspacePath
      });

      assert.equal(patchEscape.status, "failed");
      assert.match(patchEscape.error ?? "", /escapes the attached workspace/);
    });
  } finally {
    await rm(outsidePath, { force: true, recursive: true });
  }
});

test("workspace reads reject binary data and enforce configured byte limits", async () => {
  await withWorkspace(async (workspacePath) => {
    await writeFile(path.join(workspacePath, "long.txt"), "abcdef\nabcdef\n", "utf8");
    await writeFile(path.join(workspacePath, "binary.bin"), Buffer.from([65, 0, 66]));
    const executor = new LocalLlmToolExecutor({
      maxDiffBytes: 16,
      maxReadBytes: 4,
      maxSearchResults: 1,
      maxWorkspaceEntries: 1
    });

    const limited = await executor.execute({
      policy: "read_only",
      request: { id: "read-limited", name: "read_workspace_file", path: "long.txt" },
      turnId: "turn-limits",
      workspacePath
    });

    assert.deepEqual(limited.result, { content: "abcd", path: "long.txt", truncated: true });

    const listed = await executor.execute({
      policy: "read_only",
      request: { id: "list-limited", name: "list_workspace_files", maxEntries: 20 },
      turnId: "turn-limits",
      workspacePath
    });

    assert.equal((listed.result as { entries: unknown[] }).entries.length, 1);
    assert.equal((listed.result as { truncated: boolean }).truncated, true);

    const searched = await executor.execute({
      policy: "read_only",
      request: { id: "search-limited", name: "search_workspace_text", query: "abcdef", maxResults: 20 },
      turnId: "turn-limits",
      workspacePath
    });

    assert.equal((searched.result as { matches: unknown[] }).matches.length, 1);
    assert.equal((searched.result as { truncated: boolean }).truncated, true);

    const binaryRead = await executor.execute({
      policy: "read_only",
      request: { id: "read-binary", name: "read_workspace_file", path: "binary.bin" },
      turnId: "turn-limits",
      workspacePath
    });

    assert.equal(binaryRead.status, "failed");
    assert.match(binaryRead.error ?? "", /Binary files cannot be read/);

    const binaryPatch = await executor.execute({
      policy: "auto_workspace",
      request: {
        id: "patch-binary",
        name: "apply_unified_diff",
        patch: "--- a/binary.bin\n+++ b/binary.bin\n@@ -1 +1 @@\n-A\u0000B\n+text\n"
      },
      turnId: "turn-limits",
      workspacePath
    });

    assert.equal(binaryPatch.status, "failed");
    assert.match(binaryPatch.error ?? "", /configured size limit/);

    const binaryPatchExecutor = new LocalLlmToolExecutor();
    const binaryPatchWithinLimits = await binaryPatchExecutor.execute({
      policy: "auto_workspace",
      request: {
        id: "patch-binary-within-limits",
        name: "apply_unified_diff",
        patch: "--- a/binary.bin\n+++ b/binary.bin\n@@ -1 +1 @@\n-A\u0000B\n+text\n"
      },
      turnId: "turn-limits",
      workspacePath
    });

    assert.equal(binaryPatchWithinLimits.status, "failed");
    assert.match(binaryPatchWithinLimits.error ?? "", /Binary files cannot be patched/);
  });
});

test("workspace search stops at traversal, file-size, and depth budgets", async () => {
  await withWorkspace(async (workspacePath) => {
    await mkdir(path.join(workspacePath, "deep", "deeper", "deepest"), { recursive: true });
    await writeFile(path.join(workspacePath, "first.txt"), "needle\n", "utf8");
    await writeFile(path.join(workspacePath, "second.txt"), "needle\n", "utf8");
    await writeFile(path.join(workspacePath, "large.txt"), "needle in a file over the limit\n", "utf8");
    await writeFile(path.join(workspacePath, "deep", "deeper", "deepest", "target.txt"), "needle\n", "utf8");

    const fileBudgetResult = await new LocalLlmToolExecutor({
      maxSearchFiles: 1
    }).execute({
      policy: "read_only",
      request: { id: "search-file-budget", name: "search_workspace_text", query: "needle" },
      turnId: "turn-search-budget",
      workspacePath
    });

    assert.equal(fileBudgetResult.status, "completed");
    assert.ok((fileBudgetResult.result as { matches: unknown[] }).matches.length <= 1);
    assert.equal((fileBudgetResult.result as { truncated: boolean }).truncated, true);

    const fileSizeResult = await new LocalLlmToolExecutor({
      maxSearchFileBytes: 8
    }).execute({
      policy: "read_only",
      request: {
        id: "search-file-size",
        name: "search_workspace_text",
        path: "large.txt",
        query: "needle"
      },
      turnId: "turn-search-budget",
      workspacePath
    });

    assert.deepEqual(fileSizeResult.result, { matches: [], truncated: true });

    const depthResult = await new LocalLlmToolExecutor({
      maxSearchDepth: 1
    }).execute({
      policy: "read_only",
      request: {
        id: "search-depth",
        name: "search_workspace_text",
        path: "deep",
        query: "needle"
      },
      turnId: "turn-search-budget",
      workspacePath
    });

    assert.deepEqual(depthResult.result, { matches: [], truncated: true });
  });
});

test("workspace read tools stop immediately when their generation is aborted", async () => {
  await withWorkspace(async (workspacePath) => {
    await writeFile(path.join(workspacePath, "notes.txt"), "needle\n", "utf8");
    const controller = new AbortController();

    controller.abort();

    const result = await new LocalLlmToolExecutor().execute({
      policy: "read_only",
      request: { id: "aborted-search", name: "search_workspace_text", query: "needle" },
      signal: controller.signal,
      turnId: "turn-aborted",
      workspacePath
    });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /abort/i);
  });
});

test("ask mode returns durable approval-shaped action requests without writing", async () => {
  await withWorkspace(async (workspacePath) => {
    await writeFile(path.join(workspacePath, "file.txt"), "before\n", "utf8");
    const result = await new LocalLlmToolExecutor().execute({
      policy: "ask",
      request: {
        id: "patch-1",
        name: "apply_unified_diff",
        patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after\n"
      },
      turnId: "turn-ask",
      workspacePath
    });

    assert.equal(result.status, "requires_approval");
    assert.equal(result.event.type, "action_requested");
    assert.equal(result.actionRequest?.turnId, "turn-ask");
    assert.equal(await readFile(path.join(workspacePath, "file.txt"), "utf8"), "before\n");
  });
});

test("read-only, ask, auto-workspace, and full-access policies keep their write and command boundaries", async () => {
  await withWorkspace(async (workspacePath) => {
    await writeFile(path.join(workspacePath, "file.txt"), "before\n", "utf8");
    const executor = new LocalLlmToolExecutor();
    const patch = "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after\n";

    const readOnly = await executor.execute({
      policy: "read_only",
      request: { id: "readonly-patch", name: "apply_unified_diff", patch },
      turnId: "turn-policy",
      workspacePath
    });

    assert.equal(readOnly.status, "failed");

    const ask = await executor.execute({
      policy: "ask",
      request: { id: "ask-command", name: "run_workspace_command", command: "node" },
      turnId: "turn-policy",
      workspacePath
    });

    assert.equal(ask.status, "requires_approval");

    const auto = await executor.execute({
      policy: "auto_workspace",
      request: { id: "auto-command", name: "run_workspace_command", command: "node" },
      turnId: "turn-policy",
      workspacePath
    });

    assert.equal(auto.status, "requires_approval");

    const full = await executor.execute({
      policy: "full_access",
      request: { id: "full-command", name: "run_workspace_command", command: "node", args: ["-e", ""] },
      turnId: "turn-policy",
      workspacePath
    });

    assert.equal(full.status, "completed");
    assert.equal(await readFile(path.join(workspacePath, "file.txt"), "utf8"), "before\n");
  });
});

test("auto workspace atomically applies a validated unified diff and rejects stale context", async () => {
  await withWorkspace(async (workspacePath) => {
    await writeFile(path.join(workspacePath, "file.txt"), "before\n", "utf8");
    const executor = new LocalLlmToolExecutor();
    const applied = await executor.execute({
      policy: "auto_workspace",
      request: {
        id: "patch-2",
        name: "apply_unified_diff",
        patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after\n"
      },
      turnId: "turn-auto",
      workspacePath
    });

    assert.equal(applied.status, "completed");
    assert.equal(await readFile(path.join(workspacePath, "file.txt"), "utf8"), "after\n");

    const stale = await executor.execute({
      policy: "auto_workspace",
      request: {
        id: "patch-stale",
        name: "apply_unified_diff",
        patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+different\n"
      },
      turnId: "turn-auto",
      workspacePath
    });

    assert.equal(stale.status, "failed");
    assert.match(stale.error ?? "", /does not match/);
    assert.equal(await readFile(path.join(workspacePath, "file.txt"), "utf8"), "after\n");
  });
});

test("a stale file in a multi-file patch prevents every planned write", async () => {
  await withWorkspace(async (workspacePath) => {
    await writeFile(path.join(workspacePath, "first.txt"), "one\n", "utf8");
    await writeFile(path.join(workspacePath, "second.txt"), "two\n", "utf8");
    const result = await new LocalLlmToolExecutor().execute({
      policy: "full_access",
      request: {
        id: "multi-file-stale",
        name: "apply_unified_diff",
        patch: [
          "--- a/first.txt",
          "+++ b/first.txt",
          "@@ -1 +1 @@",
          "-one",
          "+changed",
          "--- a/second.txt",
          "+++ b/second.txt",
          "@@ -1 +1 @@",
          "-stale",
          "+changed",
          ""
        ].join("\n")
      },
      turnId: "turn-multi",
      workspacePath
    });

    assert.equal(result.status, "failed");
    assert.equal(await readFile(path.join(workspacePath, "first.txt"), "utf8"), "one\n");
    assert.equal(await readFile(path.join(workspacePath, "second.txt"), "utf8"), "two\n");
  });
});

test("a failed second atomic replace rolls back every file in a multi-file patch", async () => {
  await withWorkspace(async (workspacePath) => {
    await writeFile(path.join(workspacePath, "first.txt"), "one\n", "utf8");
    await writeFile(path.join(workspacePath, "second.txt"), "two\n", "utf8");
    const root = await resolveLocalLlmWorkspaceRoot(workspacePath);
    let renameCount = 0;
    const operations: LocalLlmUnifiedDiffCommitOperations = {
      mkdir,
      rename: async (source, target) => {
        renameCount += 1;
        if (renameCount === 2) throw new Error("simulated second replace failure");

        await rename(source, target);
      },
      rm,
      unlink,
      writeFile
    };

    await assert.rejects(
      applyLocalLlmUnifiedDiff(
        root,
        [
          "--- a/first.txt",
          "+++ b/first.txt",
          "@@ -1 +1 @@",
          "-one",
          "+changed-one",
          "--- a/second.txt",
          "+++ b/second.txt",
          "@@ -1 +1 @@",
          "-two",
          "+changed-two",
          ""
        ].join("\n"),
        { maxDiffBytes: 1024, maxFilesPerDiff: 2 },
        operations
      ),
      /simulated second replace failure/
    );

    assert.equal(await readFile(path.join(workspacePath, "first.txt"), "utf8"), "one\n");
    assert.equal(await readFile(path.join(workspacePath, "second.txt"), "utf8"), "two\n");
  });
});

test("the next patch recovers a durable journal left by a crash between target renames", async () => {
  await withWorkspace(async (workspacePath) => {
    const firstFileName = "first-file.txt";

    await writeFile(path.join(workspacePath, firstFileName), "one\n", "utf8");

    await writeFile(path.join(workspacePath, "second.txt"), "two\n", "utf8");
    const moduleUrl = new URL("./localLlmUnifiedDiff.ts", import.meta.url).href;
    const crashingPatch = [
      `--- a/${firstFileName}`,
      `+++ b/${firstFileName}`,
      "@@ -1 +1 @@",
      "-one",
      "+changed-one",
      "--- a/second.txt",
      "+++ b/second.txt",
      "@@ -1 +1 @@",
      "-two",
      "+changed-two",
      ""
    ].join("\n");
    const childScript = [
      "import { mkdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';",
      "import path from 'node:path';",
      "const moduleUrl = process.argv[1];",
      "const root = process.argv[2];",
      "const canonicalRoot = await realpath(root);",
      "const patch = Buffer.from(process.argv[3], 'base64').toString('utf8');",
      "const firstFileName = Buffer.from(process.argv[4], 'base64').toString('utf8');",
      "const { applyLocalLlmUnifiedDiff } = await import(moduleUrl);",
      "const operations = { mkdir, rm, unlink, writeFile, rename: async (source, target) => {",
      "  await rename(source, target);",
      "  if (target === path.join(canonicalRoot, firstFileName)) process.exit(86);",
      "} };",
      "await applyLocalLlmUnifiedDiff(root, patch, { maxDiffBytes: 4096, maxFilesPerDiff: 2 }, operations);"
    ].join("\n");

    const childResult = await runNodeFixture(childScript, [
      moduleUrl,
      workspacePath,
      Buffer.from(crashingPatch, "utf8").toString("base64"),
      Buffer.from(firstFileName, "utf8").toString("base64")
    ]);

    assert.equal(childResult.code, 86, childResult.stderr);
    assert.equal(await readFile(path.join(workspacePath, firstFileName), "utf8"), "changed-one\n");
    assert.equal(await readFile(path.join(workspacePath, "second.txt"), "utf8"), "two\n");

    await applyLocalLlmUnifiedDiff(
      await resolveLocalLlmWorkspaceRoot(workspacePath),
      `--- a/${firstFileName}\n+++ b/${firstFileName}\n@@ -1 +1 @@\n-one\n+recovered-and-patched\n`,
      { maxDiffBytes: 4096, maxFilesPerDiff: 2 }
    );

    assert.equal(await readFile(path.join(workspacePath, firstFileName), "utf8"), "recovered-and-patched\n");
    assert.equal(await readFile(path.join(workspacePath, "second.txt"), "utf8"), "two\n");
    await assert.rejects(
      readFile(path.join(workspacePath, ".deskcue-data", "local-llm-patches")),
      { code: "ENOENT" }
    );
  });
});

test("auto workspace still asks before commands while full access runs bounded command output", async () => {
  await withWorkspace(async (workspacePath) => {
    const executor = new LocalLlmToolExecutor({
      maxCommandOutputBytes: 1024,
      maxCommandTimeoutMs: 5_000,
      maxDiffBytes: 512 * 1024,
      maxFilesPerDiff: 30,
      maxReadBytes: 64 * 1024,
      maxSearchResults: 100,
      maxWorkspaceEntries: 400
    });
    const requested = await executor.execute({
      policy: "auto_workspace",
      request: { id: "command-ask", name: "run_workspace_command", command: process.execPath, args: ["-e", "console.log('ok')"] },
      turnId: "turn-command",
      workspacePath
    });

    // process.execPath is intentionally rejected as a path: commands stay PATH-only.
    assert.equal(requested.status, "requires_approval");

    const command = await executor.execute({
      policy: "full_access",
      request: { id: "command-full", name: "run_workspace_command", command: "node", args: ["-e", "console.log('ok')"] },
      turnId: "turn-command",
      workspacePath
    });

    assert.equal(command.status, "completed");
    assert.match((command.result as { output: string }).output, /ok/);
  });
});

test("full access honours the daemon executable denylist", async () => {
  await withWorkspace(async (workspacePath) => {
    const executor = new LocalLlmToolExecutor({ deniedExecutables: ["node.exe"] });
    const result = await executor.execute({
      policy: "full_access",
      request: { id: "deny-node", name: "run_workspace_command", command: "node", args: ["--version"] },
      turnId: "turn-deny",
      workspacePath
    });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /denied by this DeskCue daemon/);
  });
});

test("full access truncates command output and terminates commands at the configured timeout", async () => {
  await withWorkspace(async (workspacePath) => {
    const executor = new LocalLlmToolExecutor({
      maxCommandOutputBytes: 16,
      maxCommandTimeoutMs: 1_000
    });
    const result = await executor.execute({
      policy: "full_access",
      request: {
        id: "bounded-node",
        name: "run_workspace_command",
        command: "node",
        args: ["-e", "process.stdout.write('x'.repeat(100)); setInterval(() => {}, 1000)"],
        timeoutMs: 1_000
      },
      turnId: "turn-bounded",
      workspacePath
    });

    assert.equal(result.status, "completed");
    const command = result.result as { output: string; timedOut: boolean; truncated: boolean };

    assert.equal(command.timedOut, true);

    assert.equal(command.truncated, true);
    assert.ok(Buffer.byteLength(command.output) <= 16);
  });
});

test("aborting a workspace command terminates its descendant process tree", async () => {
  await withWorkspace(async (workspacePath) => {
    const markerPath = path.join(workspacePath, "descendant-survived.txt");
    const descendantScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'alive'), 2_500)`;
    const parentScript = [
      "require('node:child_process').spawn(",
      "process.execPath,",
      `["-e", ${JSON.stringify(descendantScript)}],`,
      "{ stdio: 'ignore' }",
      ");",
      "setInterval(() => {}, 1000);"
    ].join("");
    const controller = new AbortController();
    const execution = new LocalLlmToolExecutor({ maxCommandTimeoutMs: 5_000 }).execute({
      policy: "full_access",
      request: {
        id: "abort-process-tree",
        name: "run_workspace_command",
        command: "node",
        args: ["-e", parentScript],
        timeoutMs: 5_000
      },
      signal: controller.signal,
      turnId: "turn-process-tree",
      workspacePath
    });

    setTimeout(() => controller.abort(), 150).unref();

    const result = await execution;

    assert.equal(result.status, "failed");

    assert.match(result.error ?? "", /abort/i);
    await new Promise((resolve) => setTimeout(resolve, 2_800));
    await assert.rejects(readFile(markerPath), { code: "ENOENT" });
  });
});
