import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentSessionDetail,
  AgentSessionSourceVersion,
  AgentSessionSummary,
  AgentTranscriptActivityGroup,
  AgentTranscriptEntry,
  AgentTranscriptViewItem,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

import { buildLightweightTranscriptDelta } from "./deltaProjection.ts";
import { reconcileSourceWindowSession } from "./sessionProjection.ts";
import { doesTranscriptViewItemReferenceSourceEntry } from "./sourceRefs.ts";
import { enrichTranscriptViewSourceVersionSummary } from "./windowProjection.ts";

function activity(
  id: string,
  kind: "details" | "tools",
  label: string,
  sourceEntryCount: number,
  start: number,
  endExclusive: number
): AgentTranscriptActivityGroup {
  return {
    id,
    kind,
    label,
    timestamp: "2026-08-05T10:00:00.000Z",
    entries: [],
    entryIds: [],
    sourceEntryCount,
    sourceEntryRanges: [{
      prefix: "codex-line-",
      start,
      end: endExclusive - 1
    }]
  };
}

function entry(
  id: string,
  role: "assistant" | "user",
  text: string
): AgentTranscriptEntry {
  return {
    id,
    timestamp: "2026-08-05T10:00:00.000Z",
    role,
    text,
    phase: null,
    isCompact: false
  };
}

test("keeps stable Details/Tools identities and counts in a bounded live delta", () => {
  const userEntry = entry("codex-line-1", "user", "Run checks");
  const waitingEntry = entry("codex-line-16", "assistant", "Still checking");
  const details = activity("details:turn-1", "details", "Details (12)", 12, 2, 13);
  const tools = activity("tools:turn-1", "tools", "Tools (3)", 3, 13, 16);
  const userItem: AgentTranscriptViewItem = {
    type: "message",
    key: "message:codex-line-1",
    role: "user",
    timestamp: userEntry.timestamp,
    entry: userEntry,
    activities: [],
    changeActivities: [],
    turnStatus: null
  };
  const detailsItem: AgentTranscriptViewItem = {
    type: "activity",
    key: "activity:details:turn-1",
    activity: details
  };
  const toolsItem: AgentTranscriptViewItem = {
    type: "activity",
    key: "activity:tools:turn-1",
    activity: tools
  };
  const view: AgentTranscriptViewResponse = {
    sessionId: "codex:source-1",
    updatedAt: "2026-08-05T10:00:00.000Z",
    items: [userItem, detailsItem, toolsItem],
    latestWaitingDetailEntry: waitingEntry
  };

  const delta = buildLightweightTranscriptDelta(
    view,
    2,
    toolsItem.key,
    0
  );

  assert.equal(delta.replaceFromItemKey, detailsItem.key);
  assert.equal(delta.items[0], detailsItem);
  assert.equal(delta.items[1], toolsItem);
  assert.equal(delta.latestWaitingDetailEntry, waitingEntry);
  assert.deepEqual(delta.items.map((item) => item.key), [
    "activity:details:turn-1",
    "activity:tools:turn-1"
  ]);
  assert.equal(details.sourceEntryCount, 12);
  assert.equal(details.label, "Details (12)");
  assert.equal(tools.sourceEntryCount, 3);
  assert.equal(tools.label, "Tools (3)");
  assert.deepEqual(details.sourceEntryRanges, [{
    prefix: "codex-line-",
    start: 2,
    end: 12
  }]);
});

test("matches compact source ranges without expanding or changing their identity", () => {
  const details = activity("details:turn-1", "details", "Details (12)", 12, 2, 13);
  const item: AgentTranscriptViewItem = {
    type: "activity",
    key: "activity:details:turn-1",
    activity: details
  };

  assert.equal(doesTranscriptViewItemReferenceSourceEntry(item, "codex-line-9"), true);
  assert.equal(doesTranscriptViewItemReferenceSourceEntry(item, "codex-line-13"), false);
  assert.equal(item.activity, details);
  assert.equal(item.activity.id, "details:turn-1");
});

function summary(): AgentSessionSummary {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    cliVersion: null,
    contextCompactionCount: 0,
    filePath: "C:\\temp\\source-1.jsonl",
    id: "codex:source-1",
    model: null,
    originator: null,
    reviewedAt: null,
    source: null,
    sourceSessionId: "source-1",
    title: "Projection regression",
    updatedAt: "2026-08-05T10:00:00.000Z",
    workState: "idle",
    workspaceName: "ExampleWorkspace",
    workspacePath: "C:\\projects\\ExampleWorkspace"
  };
}

test("uses the exact bounded projection mode when enriching a missing model", async () => {
  const sourceVersion: AgentSessionSourceVersion = {
    sourceVersion: "source-v1",
    sourceFileMtimeMs: 1,
    sourceFileSizeBytes: 1024,
    summary: summary()
  };
  const detail: AgentSessionDetail = {
    ...sourceVersion.summary,
    model: "gpt-5.6-terra",
    transcript: [entry("codex-line-1", "assistant", "Ready")]
  };
  const reads: unknown[][] = [];
  let syncCount = 0;
  const sourceAgentSessions = {
    getSessionDetail: (...args: unknown[]) => {
      reads.push(args);
      return Promise.resolve(detail);
    },
    reconcileAttachedSession: (session: AgentSessionDetail) => session,
    syncReplyStateFromAgentSession: () => {
      syncCount += 1;
    }
  } as unknown as SourceAgentSessionService;

  const enriched = await enrichTranscriptViewSourceVersionSummary({
    agentSessionId: sourceVersion.summary.id,
    chatMessageTail: 24,
    includeSessionSummary: true,
    sourceAgentSessions,
    sourceVersion,
    transcriptTail: null
  });

  assert.deepEqual(reads, [[
    "codex:source-1",
    false,
    undefined,
    24,
    { lightweight: "bounded-exact-ids" }
  ]]);
  assert.equal(syncCount, 1);
  assert.equal(enriched?.summary.model, "gpt-5.6-terra");
  assert.equal("transcript" in (enriched?.summary ?? {}), false);
});

test("uses provider-neutral copy for an active source session", () => {
  const detail: AgentSessionDetail = {
    ...summary(),
    agentId: "claude-code",
    agentLabel: "Claude Code",
    id: "claude-code:source-1",
    transcript: [{
      ...entry("claude-line-1", "user", "Continue"),
      timestamp: new Date().toISOString()
    }]
  };
  const sourceAgentSessions = {
    reconcileAttachedSession: (session: AgentSessionDetail) => session
  } as unknown as SourceAgentSessionService;

  const reconciled = reconcileSourceWindowSession(sourceAgentSessions, detail);

  assert.equal(reconciled.attachMode, "read_only");
  assert.equal(
    reconciled.attachModeReason,
    "This session is active in another client right now"
  );
});
