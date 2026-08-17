import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadCodexDiscoveryFromPaths } from "./codexDiscovery.ts";

async function writeCodexSessionFile(filePath: string, sessionId: string) {
  await writeFile(
    filePath,
    JSON.stringify({
      type: "session_meta",
      payload: {
        id: sessionId,
        cwd: "D:\\work\\repo"
      }
    }),
    "utf8"
  );
}

test("discovers Codex sessions by merging index and session metadata files", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-discovery-"));
  const sessionsRoot = path.join(tempDir, "sessions");
  const nestedDir = path.join(sessionsRoot, "2026", "06");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(nestedDir, "session-a.jsonl");

  await mkdir(nestedDir, { recursive: true });
  await writeFile(
    sessionIndexPath,
    [
      JSON.stringify({
        id: "session-a",
        thread_name: "Indexed title",
        updated_at: "2026-06-22T08:00:00.000Z"
      }),
      JSON.stringify({
        id: "missing-file",
        thread_name: "No file"
      })
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    [
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "session-a",
          cwd: "D:\\work\\repo",
          originator: "codex_cli_rs",
          cli_version: "0.1.0",
          source: "codex"
        }
      }),
      JSON.stringify({
        type: "turn_context",
        payload: {
          model: "gpt-5.5",
          approval_policy: "never",
          sandbox_policy: {
            type: "danger-full-access"
          }
        }
      })
    ].join("\n"),
    "utf8"
  );

  try {
    const discovery = await loadCodexDiscoveryFromPaths({
      sessionIndexPath,
      sessionsRoot
    });

    assert.equal(discovery.summaries.length, 1);
    assert.equal(discovery.summaries[0]?.id, "session-a");
    assert.equal(discovery.summaries[0]?.threadName, "Indexed title");
    assert.equal(discovery.summaries[0]?.model, null);
    assert.equal(discovery.summaries[0]?.workspaceName, "repo");
    assert.equal(discovery.filesById.get("session-a"), sessionFilePath);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("uses the fresh session file timestamp when Codex index updated_at is stale", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-discovery-"));
  const sessionsRoot = path.join(tempDir, "sessions");
  const nestedDir = path.join(sessionsRoot, "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const olderSessionFilePath = path.join(nestedDir, "session-old.jsonl");
  const freshSessionFilePath = path.join(nestedDir, "session-fresh.jsonl");

  await mkdir(nestedDir, { recursive: true });
  await writeFile(
    sessionIndexPath,
    [
      JSON.stringify({
        id: "session-fresh",
        thread_name: "Fresh transcript",
        updated_at: "2026-06-09T18:02:38.553Z"
      }),
      JSON.stringify({
        id: "session-old",
        thread_name: "Older transcript",
        updated_at: "2026-06-29T10:26:14.170Z"
      })
    ].join("\n"),
    "utf8"
  );

  await writeCodexSessionFile(freshSessionFilePath, "session-fresh");
  await writeCodexSessionFile(olderSessionFilePath, "session-old");
  await utimes(
    freshSessionFilePath,
    new Date("2026-07-01T17:55:17.985Z"),
    new Date("2026-07-01T17:55:17.985Z")
  );
  await utimes(
    olderSessionFilePath,
    new Date("2026-06-29T10:26:14.170Z"),
    new Date("2026-06-29T10:26:14.170Z")
  );

  try {
    const discovery = await loadCodexDiscoveryFromPaths({
      sessionIndexPath,
      sessionsRoot
    });

    assert.equal(discovery.summaries[0]?.id, "session-fresh");
    assert.equal(discovery.summaries[0]?.updatedAt, "2026-07-01T17:55:17.985Z");
    assert.equal(discovery.summaries[1]?.id, "session-old");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("discovers Codex sessions with long metadata lines", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-discovery-"));
  const sessionsRoot = path.join(tempDir, "sessions");
  const nestedDir = path.join(sessionsRoot, "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(nestedDir, "session-long-meta.jsonl");

  await mkdir(nestedDir, { recursive: true });
  await writeFile(sessionIndexPath, "", "utf8");
  await writeFile(
    sessionFilePath,
    [
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "session-long-meta",
          cwd: "D:\\work\\repo",
          base_instructions: {
            text: "x".repeat(12 * 1024)
          }
        }
      }),
      JSON.stringify({
        type: "turn_context",
        payload: {
          model: "gpt-5.5"
        }
      })
    ].join("\n"),
    "utf8"
  );

  try {
    const discovery = await loadCodexDiscoveryFromPaths({
      sessionIndexPath,
      sessionsRoot
    });

    assert.equal(discovery.summaries.length, 1);
    assert.equal(discovery.summaries[0]?.id, "session-long-meta");
    assert.equal(discovery.filesById.get("session-long-meta"), sessionFilePath);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
