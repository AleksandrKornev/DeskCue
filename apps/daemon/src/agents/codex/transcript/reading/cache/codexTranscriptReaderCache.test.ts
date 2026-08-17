import assert from "node:assert/strict";
import type { Stats } from "node:fs";
import test from "node:test";

import type { AgentTranscriptEntry, CodexSessionDetail } from "@deskcue/protocol";

import type { CodexTranscriptLifecycle } from "../codexTranscriptLifecycle.ts";
import { createCodexTranscriptReaderCache } from "./codexTranscriptReaderCache.ts";
import type { CodexTranscriptTailReader } from "../codexTranscriptTailReader.ts";

function createCollaborators(marker: string) {
  let snapshotReadCount = 0;
  const tailReader = {
    async readTranscriptLineIndexSnapshot(_filePath: string, fileStat: Stats) {
      snapshotReadCount += 1;
      return {
        endsWithLineBreak: true,
        lineBreakCount: marker === "a" ? 1 : 2,
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size
      };
    }
  } as unknown as CodexTranscriptTailReader;
  const lifecycle = {
    async readRangeBuffer() {
      return Buffer.from([0x0a]);
    }
  } as unknown as CodexTranscriptLifecycle;

  return {
    lifecycle,
    snapshotReads: () => snapshotReadCount,
    tailReader
  };
}

function detail(id: string): CodexSessionDetail {
  const marker = id.at(-1) ?? id;
  const transcript: AgentTranscriptEntry[] = [{
    id: `entry-${marker}`,
    phase: null,
    role: "assistant",
    text: `message-${marker}`,
    timestamp: "2026-08-05T10:00:00.000Z"
  }];

  return {
    approvalPolicy: null,
    cliVersion: null,
    filePath: `transcript-${marker}.jsonl`,
    id,
    model: null,
    originator: null,
    sandboxMode: null,
    source: null,
    threadName: `Session ${marker}`,
    transcript,
    updatedAt: "2026-08-05T10:00:00.000Z",
    workspaceName: "DeskCue",
    workspacePath: "D:\\work\\DeskCue"
  };
}

test("keeps detail, appendable, and tail-window caches isolated per factory instance", async () => {
  const collaboratorsA = createCollaborators("a");
  const collaboratorsB = createCollaborators("b");
  const cacheA = createCodexTranscriptReaderCache(
    collaboratorsA.tailReader,
    collaboratorsA.lifecycle
  );
  const cacheB = createCodexTranscriptReaderCache(
    collaboratorsB.tailReader,
    collaboratorsB.lifecycle
  );
  const detailA = detail("session-a");
  const detailB = detail("session-b");
  const fileStat = { mtimeMs: 10, size: 128 } as Stats;

  cacheA.setDetailCache("detail:a", detailA);
  cacheB.setDetailCache("detail:b", detailB);
  assert.equal(cacheB.readDetailCache("detail:a"), null);
  assert.equal(cacheA.readDetailCache("detail:b"), null);
  assert.equal(cacheA.readDetailCache("detail:a")?.id, "session-a");
  assert.equal(cacheB.readDetailCache("detail:b")?.id, "session-b");

  await cacheA.setAppendableDetailCache(
    "appendable:a",
    "transcript-a.jsonl",
    fileStat,
    detailA
  );
  await cacheB.setAppendableDetailCache(
    "appendable:b",
    "transcript-b.jsonl",
    fileStat,
    detailB
  );
  assert.equal(
    await cacheB.readAppendableDetailCache("appendable:a", {
      filePath: "transcript-b.jsonl",
      fileStat,
      sessionId: "session-b",
      summary: detailB
    }),
    null
  );
  assert.equal(
    await cacheA.readAppendableDetailCache("appendable:b", {
      filePath: "transcript-a.jsonl",
      fileStat,
      sessionId: "session-a",
      summary: detailA
    }),
    null
  );
  assert.equal(collaboratorsA.snapshotReads(), 1);
  assert.equal(collaboratorsB.snapshotReads(), 1);

  cacheA.setTranscriptTailWindowCache("window:a", fileStat, detailA.transcript);
  cacheB.setTranscriptTailWindowCache("window:b", fileStat, detailB.transcript);
  assert.equal(cacheB.readTranscriptTailWindowCache("window:a", fileStat), null);
  assert.equal(cacheA.readTranscriptTailWindowCache("window:b", fileStat), null);
  assert.equal(
    cacheA.readTranscriptTailWindowCache("window:a", fileStat)?.[0]?.text,
    "message-a"
  );
  assert.equal(
    cacheB.readTranscriptTailWindowCache("window:b", fileStat)?.[0]?.text,
    "message-b"
  );
});
