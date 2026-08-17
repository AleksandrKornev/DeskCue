import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTranscriptActivityGroup,
  AgentTranscriptEntry,
  AgentTranscriptViewItem,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";

import {
  mergeAgentSessionDetail,
  mergeAgentSessionTranscriptPage
} from "./transcriptMerge";

const baseTimestamp = "2026-07-17T10:00:00.000Z";

function createEntry(id: string, text: string, timestamp = baseTimestamp): AgentTranscriptEntry {
  return {
    id,
    isCompact: false,
    phase: null,
    role: "assistant",
    text,
    timestamp
  };
}

function createActivityGroup(
  id: string,
  entries: AgentTranscriptEntry[]
): AgentTranscriptActivityGroup {
  return {
    id,
    entries,
    entryIds: entries.map((entry) => entry.id),
    kind: "tools",
    label: `Tools (${entries.length})`,
    sourceEntryCount: entries.length,
    sourceEntryIds: entries.map((entry) => entry.id),
    timestamp: entries[0]?.timestamp ?? baseTimestamp
  };
}

function createSummary(id = "codex:session"): AgentSessionSummary {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    cliVersion: null,
    contextCompactionCount: 0,
    filePath: "C:/tmp/session.jsonl",
    id,
    model: null,
    originator: null,
    reviewedAt: null,
    source: null,
    sourceSessionId: id.slice(id.indexOf(":") + 1),
    title: "Regression chat",
    updatedAt: baseTimestamp,
    workState: "idle",
    workspaceName: "DeskCue",
    workspacePath: "D:/projects/example-workspace"
  };
}

function createSessionDetail(
  overrides: Partial<AgentSessionDetail> = {}
): AgentSessionDetail {
  const summary = createSummary();
  return {
    ...summary,
    transcript: [],
    ...overrides
  };
}

function createTranscriptView({
  items,
  latestWaitingDetailEntry = null,
  session = createSummary(),
  updatedAt = baseTimestamp
}: {
  items: AgentTranscriptViewItem[];
  latestWaitingDetailEntry?: AgentTranscriptEntry | null;
  session?: AgentSessionSummary;
  updatedAt?: string;
}): AgentTranscriptViewResponse {
  return {
    items,
    latestWaitingDetailEntry,
    session,
    sessionId: session.id,
    updatedAt
  };
}

describe("mergeAgentSessionDetail", () => {
  it("preserves transcript view item references when only freshness changes", () => {
    const messageEntry = createEntry("entry:message", "done");
    const toolEntry = createEntry("entry:tool", "tool output");
    const activity = createActivityGroup("activity:tools", [toolEntry]);
    const messageItem: AgentTranscriptViewItem = {
      activities: [activity],
      changeActivities: [],
      entry: messageEntry,
      key: "message:entry",
      role: "assistant",
      timestamp: messageEntry.timestamp,
      turnStatus: null,
      type: "message"
    };
    const summary = createSummary();
    const current = createSessionDetail({
      transcript: [messageEntry],
      transcriptView: createTranscriptView({ items: [messageItem], session: summary })
    });
    const nextMessageEntry = { ...messageEntry };
    const nextToolEntry = { ...toolEntry };
    const nextActivity = createActivityGroup("activity:tools", [nextToolEntry]);
    const next = createSessionDetail({
      transcript: [nextMessageEntry],
      transcriptView: createTranscriptView({
        items: [{
          ...messageItem,
          activities: [nextActivity],
          entry: nextMessageEntry
        }],
        session: { ...summary },
        updatedAt: "2026-07-17T10:00:01.000Z"
      }),
      updatedAt: "2026-07-17T10:00:01.000Z"
    });

    const merged = mergeAgentSessionDetail(current, next);

    assert.notEqual(merged, current);
    assert.equal(merged.transcript, current.transcript);
    assert.equal(merged.transcriptView?.items[0], messageItem);
    assert.equal(merged.transcriptView?.items[0]?.type, "message");
    assert.equal(merged.transcriptView?.session, summary);
  });

  it("returns the current session object when transcript and view are unchanged", () => {
    const messageEntry = createEntry("entry:message", "done");
    const messageItem: AgentTranscriptViewItem = {
      activities: [],
      changeActivities: [],
      entry: messageEntry,
      key: "message:entry",
      role: "assistant",
      timestamp: messageEntry.timestamp,
      turnStatus: null,
      type: "message"
    };
    const current = createSessionDetail({
      transcript: [messageEntry],
      transcriptView: createTranscriptView({ items: [messageItem] })
    });
    const next = createSessionDetail({
      transcript: [{ ...messageEntry }],
      transcriptView: createTranscriptView({
        items: [{
          ...messageItem,
          entry: { ...messageEntry }
        }]
      })
    });

    assert.equal(mergeAgentSessionDetail(current, next), current);
  });

  it("keeps a lifecycle-only refresh instead of discarding it as an unchanged transcript", () => {
    const current = createSessionDetail({ transcript: [] });
    const next = {
      ...createSessionDetail({ transcript: [] }),
      interruptLifecycle: {
        phase: "requested" as const,
        requestedAt: "2026-07-30T10:00:00.000Z",
        confirmedAt: null,
        turnFingerprint: "turn-1",
        confirmation: null
      }
    } as AgentSessionDetail;

    assert.notEqual(mergeAgentSessionDetail(current, next), current);
  });

  it("preserves latest waiting detail entry reference when payload is equal", () => {
    const messageEntry = createEntry("entry:message", "working");
    const waitingEntry = createEntry("entry:waiting", "waiting for approval");
    const current = createSessionDetail({
      transcript: [messageEntry],
      transcriptView: createTranscriptView({
        items: [],
        latestWaitingDetailEntry: waitingEntry
      })
    });
    const next = createSessionDetail({
      transcript: [{ ...messageEntry }],
      transcriptView: createTranscriptView({
        items: [],
        latestWaitingDetailEntry: { ...waitingEntry },
        updatedAt: "2026-07-17T10:00:01.000Z"
      }),
      updatedAt: "2026-07-17T10:00:01.000Z"
    });

    const merged = mergeAgentSessionDetail(current, next);

    assert.notEqual(merged, current);
    assert.equal(
      merged.transcriptView?.latestWaitingDetailEntry,
      waitingEntry
    );
  });

  it("preserves an explicitly loaded transcript view when a fresh detail omits transcriptView", () => {
    const messageEntry = createEntry("entry:message", "done");
    const current = createSessionDetail({
      transcript: [messageEntry],
      transcriptView: createTranscriptView({ items: [] })
    });
    const next = createSessionDetail({
      transcript: [{ ...messageEntry }],
      updatedAt: "2026-07-17T10:00:01.000Z"
    });

    const merged = mergeAgentSessionDetail(current, next);

    assert.notEqual(merged, current);
    assert.equal(merged.transcriptView, current.transcriptView);
  });

  it("replaces a changed activity group while keeping unchanged entry references", () => {
    const messageEntry = createEntry("entry:message", "done");
    const currentToolEntry = createEntry("entry:tool", "old tool output");
    const currentActivity = createActivityGroup("activity:tools", [currentToolEntry]);
    const currentItem: AgentTranscriptViewItem = {
      activities: [currentActivity],
      changeActivities: [],
      entry: messageEntry,
      key: "message:entry",
      role: "assistant",
      timestamp: messageEntry.timestamp,
      turnStatus: null,
      type: "message"
    };
    const current = createSessionDetail({
      transcript: [messageEntry],
      transcriptView: createTranscriptView({ items: [currentItem] })
    });
    const nextToolEntry = createEntry("entry:tool", "new tool output");
    const nextActivity = createActivityGroup("activity:tools", [nextToolEntry]);
    const next = createSessionDetail({
      transcript: [{ ...messageEntry }],
      transcriptView: createTranscriptView({
        items: [{
          ...currentItem,
          activities: [nextActivity],
          entry: { ...messageEntry }
        }],
        updatedAt: "2026-07-17T10:00:01.000Z"
      }),
      updatedAt: "2026-07-17T10:00:01.000Z"
    });

    const merged = mergeAgentSessionDetail(current, next);
    const mergedItem = merged.transcriptView?.items[0];

    assert.notEqual(mergedItem, currentItem);
    assert.equal(mergedItem?.type, "message");
    if (mergedItem?.type === "message") {
      assert.notEqual(mergedItem.activities[0], currentActivity);
      assert.equal(mergedItem.entry, messageEntry);
      assert.equal(mergedItem.activities[0]?.entries[0]?.text, "new tool output");
    }
  });

  it("keeps a known context-compaction count when a stale detail reports zero", () => {
    const current = createSessionDetail({ contextCompactionCount: 8 });
    const next = createSessionDetail({ contextCompactionCount: 0 });

    const merged = mergeAgentSessionDetail(current, next);

    assert.equal(merged.contextCompactionCount, 8);
  });

  it("keeps a known model while a partial live detail has no model", () => {
    const current = createSessionDetail({ model: "gpt-5.6-terra" });
    const next = createSessionDetail({
      model: null,
      updatedAt: "2026-07-17T10:00:01.000Z"
    });

    const merged = mergeAgentSessionDetail(current, next);

    assert.equal(merged.model, "gpt-5.6-terra");
  });

  it("replaces an append-growing compact entry when its source refs expand", () => {
    const currentEntry: AgentTranscriptEntry = {
      ...createEntry("entry:compact", "first detail"),
      isCompact: true,
      sourceEntryCount: 1,
      sourceEntryIds: ["source:1"]
    };
    const nextEntry: AgentTranscriptEntry = {
      ...currentEntry,
      text: "first detail\nsecond detail",
      sourceEntryCount: 2,
      sourceEntryIds: ["source:1", "source:2"]
    };
    const current = createSessionDetail({ transcript: [currentEntry] });
    const next = createSessionDetail({
      transcript: [nextEntry],
      updatedAt: "2026-07-17T10:00:01.000Z"
    });

    const merged = mergeAgentSessionDetail(current, next);

    assert.notEqual(merged.transcript[0], currentEntry);
    assert.equal(merged.transcript[0], nextEntry);
    assert.deepEqual(merged.transcript[0]?.sourceEntryIds, ["source:1", "source:2"]);
  });

  it("applies a partial transcript delta without replacing unchanged historical entries", () => {
    const historicalEntry = createEntry(
      "entry:historical",
      "already complete",
      "2026-07-17T09:59:00.000Z"
    );
    const streamingEntry = createEntry("entry:streaming", "partial");
    const completedEntry = { ...streamingEntry, text: "partial response completed" };
    const current = createSessionDetail({
      transcript: [historicalEntry, streamingEntry]
    });
    const next = createSessionDetail({
      transcript: [completedEntry],
      updatedAt: "2026-07-17T10:00:01.000Z"
    });

    const merged = mergeAgentSessionDetail(current, next);

    assert.deepEqual(merged.transcript.map((entry) => entry.id), [
      "entry:historical",
      "entry:streaming"
    ]);
    assert.equal(merged.transcript[0], historicalEntry);
    assert.equal(merged.transcript[1], completedEntry);
  });
});

describe("mergeAgentSessionTranscriptPage", () => {
  it("prepends transcript view page items and keeps existing item references", () => {
    const currentEntry = createEntry("entry:current", "current", "2026-07-17T10:01:00.000Z");
    const pageEntry = createEntry("entry:page", "earlier", "2026-07-17T09:59:00.000Z");
    const currentItem: AgentTranscriptViewItem = {
      activities: [],
      changeActivities: [],
      entry: currentEntry,
      key: "message:current",
      role: "assistant",
      timestamp: currentEntry.timestamp,
      turnStatus: null,
      type: "message"
    };
    const pageItem: AgentTranscriptViewItem = {
      activities: [],
      changeActivities: [],
      entry: pageEntry,
      key: "message:page",
      role: "assistant",
      timestamp: pageEntry.timestamp,
      turnStatus: null,
      type: "message"
    };
    const current = createSessionDetail({
      transcript: [currentEntry],
      transcriptView: createTranscriptView({ items: [currentItem] })
    });

    const merged = mergeAgentSessionTranscriptPage(current, current.id, {
      entries: [pageEntry],
      transcriptView: createTranscriptView({ items: [pageItem] })
    });

    assert.notEqual(merged, current);
    assert.deepEqual(
      merged?.transcriptView?.items.map((item) => item.key),
      ["message:page", "message:current"]
    );
    assert.equal(merged?.transcriptView?.items[1], currentItem);
  });

  it("bounds manually loaded history and preserves its window during an automatic tail merge", () => {
    const currentEntry = createEntry("entry:current", "current", "2026-07-17T10:01:00.000Z");
    const currentItem: AgentTranscriptViewItem = {
      activities: [],
      changeActivities: [],
      entry: currentEntry,
      key: "message:current",
      role: "assistant",
      timestamp: currentEntry.timestamp,
      turnStatus: null,
      type: "message"
    };
    const current = createSessionDetail({
      transcript: [currentEntry],
      transcriptView: createTranscriptView({ items: [currentItem] })
    });
    const historyEntries = Array.from({ length: 600 }, (_, index) =>
      createEntry(
        `entry:history:${index}`,
        `history ${index}`,
        new Date(Date.parse(baseTimestamp) - (600 - index) * 1_000).toISOString()
      )
    );
    const historyItems: AgentTranscriptViewItem[] = historyEntries.map((entry) => ({
      activities: [],
      changeActivities: [],
      entry,
      key: `message:${entry.id}`,
      role: "assistant",
      timestamp: entry.timestamp,
      turnStatus: null,
      type: "message"
    }));

    const historyProtection = {
      entryIds: new Set(historyEntries.map((entry) => entry.id)),
      viewItemKeys: new Set(historyItems.map((item) => item.key))
    };
    const withHistory = mergeAgentSessionTranscriptPage(current, current.id, {
      entries: historyEntries,
      transcriptView: createTranscriptView({ items: historyItems })
    }, historyProtection);

    assert.equal(withHistory?.transcript.length, 513);
    assert.equal(withHistory?.transcriptView?.items.length, 513);
    const retainedHistoryId = withHistory?.transcript[0]?.id;
    const refreshed = mergeAgentSessionDetail(withHistory, createSessionDetail({
      transcript: [currentEntry],
      transcriptView: createTranscriptView({
        items: [currentItem],
        updatedAt: "2026-07-17T10:02:00.000Z"
      }),
      updatedAt: "2026-07-17T10:02:00.000Z"
    }), historyProtection);

    assert.equal(refreshed.transcript.length, 513);
    assert.equal(refreshed.transcript[0]?.id, retainedHistoryId);
    assert.equal(refreshed.transcriptView?.items.length, 513);
    assert.equal(refreshed.transcriptView?.items[0]?.key, `message:${retainedHistoryId}`);
  });
});
