import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionSourceVersion,
  AgentSessionSummary,
  AgentTranscriptEntry,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

import {
  AgentTranscriptHttpCache,
  buildTranscriptViewCacheKey,
  shouldCacheTranscriptViewForSourceVersion
} from "./agentTranscriptHttpCache.ts";

function transcriptEntry(id: string): AgentTranscriptEntry {
  return {
    id,
    timestamp: "2026-08-05T01:00:00.000Z",
    role: "assistant",
    text: id,
    phase: null
  };
}

function summary(workState: AgentSessionSummary["workState"]): AgentSessionSummary {
  return {
    id: "codex:1",
    agentId: "codex",
    agentLabel: "Codex",
    sourceSessionId: "1",
    title: "Test",
    workspacePath: null,
    workspaceName: null,
    updatedAt: "2026-08-05T01:00:00.000Z",
    model: null,
    originator: null,
    cliVersion: null,
    source: null,
    filePath: "C:/test.jsonl",
    attachMode: "resume",
    workState
  };
}

function transcriptView(text: string): AgentTranscriptViewResponse {
  return {
    sessionId: "codex:1",
    updatedAt: "2026-08-05T01:00:00.000Z",
    session: summary("idle"),
    items: [],
    latestWaitingDetailEntry: transcriptEntry(text)
  };
}

test("keeps transcript views in LRU order and omits the duplicated session summary", () => {
  const cache = new AgentTranscriptHttpCache({
    viewItemMaxBytes: 10_000,
    viewMaxBytes: 10_000,
    viewSizeLimit: 2
  });

  cache.setView("a", transcriptView("a"), 1);
  cache.setView("b", transcriptView("b"), 2);
  assert.equal(cache.readView("a")?.view.session, undefined);

  cache.setView("c", transcriptView("c"), 3);

  assert.equal(cache.readView("b"), null);
  assert.equal(cache.readView("a")?.transcriptEntryCount, 1);
  assert.equal(cache.readView("c")?.transcriptEntryCount, 3);
});

test("does not cache an oversized transcript view", () => {
  const cache = new AgentTranscriptHttpCache({ viewItemMaxBytes: 64 });

  cache.setView("large", transcriptView("x".repeat(256)), 1);

  assert.equal(cache.readView("large"), null);
});

function version(
  sourceVersion: string,
  workState: AgentSessionSummary["workState"] = "idle"
): AgentSessionSourceVersion {
  return {
    summary: summary(workState),
    sourceFileMtimeMs: 1,
    sourceFileSizeBytes: 1,
    sourceVersion
  };
}

test("negative transcript-entry reads are scoped to the source version", async () => {
  const cache = new AgentTranscriptHttpCache();
  const reads: string[][] = [];
  const service = {
    async getTranscriptEntries(_agentSessionId: string, entryIds: string[]) {
      reads.push(entryIds);
      return entryIds.includes("found") ? [transcriptEntry("found")] : [];
    }
  } as unknown as SourceAgentSessionService;

  const first = await cache.readEntries(service, "codex:1", ["missing", "found"], version("v1"));
  const second = await cache.readEntries(service, "codex:1", ["missing", "found"], version("v1"));
  const changedVersion = await cache.readEntries(
    service,
    "codex:1",
    ["missing", "found"],
    version("v2")
  );

  assert.deepEqual(reads, [
    ["missing", "found"],
    ["found"],
    ["missing", "found"]
  ]);
  assert.equal(first.cachedMissCount, 0);
  assert.equal(second.cachedMissCount, 1);
  assert.equal(changedVersion.cachedMissCount, 0);
});

test("builds stable view keys and only caches finished source versions", () => {
  const options = {
    chatMessageTail: 40,
    fullTranscript: false,
    transcriptDetail: "summary" as const,
    transcriptTail: null,
    waitingSince: null
  };

  assert.equal(
    buildTranscriptViewCacheKey(version("v1"), options),
    buildTranscriptViewCacheKey(version("v1"), options)
  );
  assert.equal(shouldCacheTranscriptViewForSourceVersion(version("v1", "idle")), true);
  assert.equal(shouldCacheTranscriptViewForSourceVersion(version("v1", "running")), false);
});
