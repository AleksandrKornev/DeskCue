import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { daemonConfig } from "#config/daemonConfig";

import { getCodexTranscriptTailWindow } from "./codexFacade.ts";

function jsonl(records: Array<Record<string, unknown>>) {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

test("keeps parser-supported Codex commentary visible in the indexed tail window", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-hydration-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionId = "session-detail-hydration";

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    path.join(tempDir, "session_index.jsonl"),
    jsonl([{
      id: sessionId,
      thread_name: "Detail hydration",
      updated_at: "2026-07-30T01:22:00.000Z"
    }]),
    "utf8"
  );
  await writeFile(
    path.join(sessionsRoot, `${sessionId}.jsonl`),
    `${jsonl([
      {
        type: "session_meta",
        payload: { id: sessionId, cwd: "D:\\work\\repo" }
      },
      {
        type: "response_item",
        timestamp: "2026-07-30T01:22:00.000Z",
        payload: {
          type: "reasoning",
          text: "Internal reasoning must not become an unhydrated detail"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-30T01:22:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [{ type: "output_text", text: "Visible live detail" }]
        }
      }
    ])}\n`,
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    const entries = await getCodexTranscriptTailWindow(sessionId, {
      chatMessageTail: 1,
      force: true
    });
    assert.deepEqual(entries?.map((entry) => entry.text), ["Visible live detail"]);
    assert.equal(entries?.[0]?.isCompact, undefined);
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});
