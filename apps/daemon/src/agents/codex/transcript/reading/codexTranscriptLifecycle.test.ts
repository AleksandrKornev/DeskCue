import assert from "node:assert/strict";
import {
  appendFile,
  mkdtemp,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { CodexTranscriptLifecycle } from "./codexTranscriptLifecycle.ts";
import type { CodexTranscriptLineIndex } from "./index/codexTranscriptLineIndex.ts";

test("keeps context compaction markers correct across append-only lifecycle refreshes", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-lifecycle-"));
  const filePath = path.join(tempDir, "session.jsonl");
  const lifecycle = new CodexTranscriptLifecycle({} as CodexTranscriptLineIndex);

  await writeFile(filePath, [
    JSON.stringify({ type: "turn_context", payload: { cwd: "D:\\work\\repo" } }),
    JSON.stringify({ type: "compacted", timestamp: "2026-08-05T10:00:00.000Z" }),
    ""
  ].join("\n"), "utf8");

  try {
    assert.equal(await lifecycle.countContextCompactionMarkers(filePath, await stat(filePath)), 1);

    await appendFile(filePath, [
      JSON.stringify({ type: "turn_context", payload: { cwd: "D:\\work\\repo" } }),
      JSON.stringify({ type: "compacted", timestamp: "2026-08-05T10:00:01.000Z" }),
      ""
    ].join("\n"), "utf8");

    assert.equal(await lifecycle.countContextCompactionMarkers(filePath, await stat(filePath)), 2);
    assert.equal(await lifecycle.countContextCompactionMarkers(filePath, await stat(filePath)), 2);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
