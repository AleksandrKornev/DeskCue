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
  entries: AgentTranscriptEntry[],
  kind: AgentTranscriptActivityGroup["kind"] = "tools"
): AgentTranscriptActivityGroup {
  const label = kind === "changes"
    ? `Changes (${entries.length})`
    : kind === "details"
      ? `Details (${entries.length})`
      : `Tools (${entries.length})`;

  return {
    id,
    entries,
    entryIds: entries.map((entry) => entry.id),
    kind,
    label,
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

  it("keeps a terminal source-turn refresh after the final transcript was already merged", () => {
    const finalEntry = createEntry("entry:final", "done");
    const activeTurnState = {
      activityAt: baseTimestamp,
      completedAt: null,
      evidence: "recent_non_final_activity" as const,
      fingerprint: "turn-1",
      phase: "active" as const,
      startedAt: baseTimestamp
    };

    const completedTurnState = {
      activityAt: null,
      completedAt: baseTimestamp,
      evidence: "terminal_lifecycle" as const,
      fingerprint: "turn-1",
      phase: "completed" as const,
      startedAt: null
    };

    const current = createSessionDetail({
      transcript: [finalEntry],
      turnState: activeTurnState,
      workState: "running"
    });
    const next = createSessionDetail({
      transcript: [{ ...finalEntry }],
      turnState: completedTurnState,
      workState: "idle"
    });

    const merged = mergeAgentSessionDetail(current, next);

    assert.notEqual(merged, current);
    assert.equal(merged.workState, "idle");
    assert.deepEqual(merged.turnState, completedTurnState);
    assert.equal(merged.transcript, current.transcript);
  });

  it("keeps terminal lifecycle when a stale active detail adds the final transcript", () => {
    const userEntry = {
      ...createEntry("entry:user", "run", "2026-07-17T10:00:00.000Z"),
      role: "user" as const
    };

    const finalEntry = createEntry("entry:final", "done", "2026-07-17T10:00:05.000Z");
    const completedTurnState = {
      activityAt: null,
      completedAt: "2026-07-17T10:00:05.000Z",
      evidence: "terminal_lifecycle" as const,
      fingerprint: "terminal-1",
      phase: "completed" as const,
      startedAt: null
    };

    const staleActiveTurnState = {
      activityAt: "2026-07-17T10:00:01.000Z",
      completedAt: null,
      evidence: "recent_non_final_activity" as const,
      fingerprint: "start-1",
      phase: "active" as const,
      startedAt: "2026-07-17T10:00:00.000Z"
    };

    const current = createSessionDetail({
      transcript: [userEntry],
      turnState: completedTurnState,
      workState: "idle"
    });
    const staleRefresh = createSessionDetail({
      transcript: [userEntry, finalEntry],
      turnState: staleActiveTurnState,
      updatedAt: "2026-07-17T10:00:05.000Z",
      workState: "running"
    });

    const merged = mergeAgentSessionDetail(current, staleRefresh);

    assert.equal(merged.transcript.at(-1)?.id, finalEntry.id);
    assert.equal(merged.workState, "idle");
    assert.deepEqual(merged.turnState, completedTurnState);
  });

  it("accepts an active source lifecycle that starts after the completed turn", () => {
    const current = createSessionDetail({
      turnState: {
        activityAt: null,
        completedAt: "2026-07-17T10:00:05.000Z",
        evidence: "terminal_lifecycle",
        fingerprint: "terminal-1",
        phase: "completed",
        startedAt: null
      },
      workState: "idle"
    });
    const next = createSessionDetail({
      turnState: {
        activityAt: "2026-07-17T10:00:10.000Z",
        completedAt: null,
        evidence: "recent_non_final_activity",
        fingerprint: "start-2",
        phase: "active",
        startedAt: "2026-07-17T10:00:10.000Z"
      },
      updatedAt: "2026-07-17T10:00:10.000Z",
      workState: "running"
    });

    const merged = mergeAgentSessionDetail(current, next);

    assert.equal(merged.workState, "running");
    assert.equal(merged.turnState?.fingerprint, "start-2");
  });

  it("accepts a different active turn that starts at the completed turn timestamp", () => {
    const timestamp = "2026-07-17T10:00:05.000Z";
    const current = createSessionDetail({
      turnState: {
        activityAt: null,
        completedAt: timestamp,
        evidence: "terminal_lifecycle",
        fingerprint: "terminal-1",
        phase: "completed",
        startedAt: null,
        turnStartFingerprint: "start-1"
      },
      workState: "idle"
    });
    const next = createSessionDetail({
      turnState: {
        activityAt: timestamp,
        completedAt: null,
        evidence: "unanswered_user_turn",
        fingerprint: "start-2",
        phase: "active",
        startedAt: timestamp
      },
      updatedAt: timestamp,
      workState: "running"
    });

    const merged = mergeAgentSessionDetail(current, next);

    assert.equal(merged.workState, "running");
    assert.equal(merged.turnState?.fingerprint, "start-2");
  });

  it("retains a terminal lifecycle for the same identified turn at an equal timestamp", () => {
    const timestamp = "2026-07-17T10:00:05.000Z";
    const current = createSessionDetail({
      turnState: {
        activityAt: null,
        completedAt: timestamp,
        evidence: "terminal_lifecycle",
        fingerprint: "terminal-1",
        phase: "completed",
        startedAt: null,
        turnStartFingerprint: "start-1"
      },
      workState: "idle"
    });
    const staleActive = createSessionDetail({
      turnState: {
        activityAt: timestamp,
        completedAt: null,
        evidence: "turn_lifecycle",
        fingerprint: "start-1",
        phase: "active",
        startedAt: timestamp
      },
      updatedAt: timestamp,
      workState: "running"
    });

    const merged = mergeAgentSessionDetail(current, staleActive);

    assert.equal(merged.workState, "idle");
    assert.equal(merged.turnState?.fingerprint, "terminal-1");
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

  it("drops standalone activities after the terminal reply embeds the same groups", () => {
    const userEntry = {
      ...createEntry("entry:user", "run the check", "2026-07-17T10:00:00.000Z"),
      role: "user" as const
    };

    const detailEntry = createEntry(
      "entry:detail",
      "checking the file",
      "2026-07-17T10:00:01.000Z"
    );
    const toolEntry = {
      ...createEntry("entry:tool", "tool output", "2026-07-17T10:00:02.000Z"),
      role: "tool" as const
    };

    const assistantEntry = createEntry(
      "entry:assistant",
      "done",
      "2026-07-17T10:00:03.000Z"
    );
    const details = createActivityGroup("details:turn", [detailEntry], "details");
    const tools = createActivityGroup("tools:turn", [toolEntry]);
    const userItem: AgentTranscriptViewItem = {
      activities: [],
      changeActivities: [],
      entry: userEntry,
      key: "message:user",
      role: "user",
      timestamp: userEntry.timestamp,
      turnStatus: null,
      type: "message"
    };

    const current = createSessionDetail({
      transcript: [userEntry, detailEntry, toolEntry],
      transcriptView: createTranscriptView({
        items: [
          userItem,
          { activity: details, key: details.id, type: "activity" },
          { activity: tools, key: tools.id, type: "activity" }
        ]
      })
    });
    const terminal = createSessionDetail({
      transcript: [userEntry, detailEntry, toolEntry, assistantEntry],
      transcriptView: createTranscriptView({
        items: [
          userItem,
          {
            activities: [details, tools],
            changeActivities: [],
            entry: assistantEntry,
            key: "message:assistant",
            role: "assistant",
            timestamp: assistantEntry.timestamp,
            turnStatus: null,
            type: "message"
          }
        ],
        updatedAt: "2026-07-17T10:00:04.000Z"
      }),
      updatedAt: "2026-07-17T10:00:04.000Z"
    });

    const merged = mergeAgentSessionDetail(current, terminal);
    const repeated = mergeAgentSessionDetail(merged, terminal);

    assert.deepEqual(
      merged.transcriptView?.items.map((item) => [item.type, item.key]),
      [
        ["message", "message:user"],
        ["message", "message:assistant"]
      ]
    );

    assert.equal(repeated, merged);
  });

  it("clears stale historical turn status and activity after a later prompt completes", () => {
    const firstUserEntry = {
      ...createEntry("entry:user-1", "first prompt", "2026-07-17T10:00:00.000Z"),
      role: "user" as const
    };

    const firstDetailEntry = createEntry(
      "entry:detail-1",
      "checking",
      "2026-07-17T10:00:01.000Z"
    );
    const firstAssistantEntry = createEntry(
      "entry:assistant-1",
      "first final",
      "2026-07-17T10:00:02.000Z"
    );
    const secondUserEntry = {
      ...createEntry("entry:user-2", "second prompt", "2026-07-17T10:01:00.000Z"),
      role: "user" as const
    };

    const secondAssistantEntry = createEntry(
      "entry:assistant-2",
      "second final",
      "2026-07-17T10:01:02.000Z"
    );
    const details = createActivityGroup("details:first", [firstDetailEntry], "details");
    const staleUserItem: AgentTranscriptViewItem = {
      activities: [],
      changeActivities: [],
      entry: firstUserEntry,
      key: "message:user-1",
      role: "user",
      timestamp: firstUserEntry.timestamp,
      turnStatus: {
        kind: "incomplete",
        label: "No final reply",
        title: "The source agent finished before DeskCue received a final reply"
      },
      type: "message"
    };

    const firstAssistantItem: AgentTranscriptViewItem = {
      activities: [details],
      changeActivities: [],
      entry: firstAssistantEntry,
      key: "message:assistant-1",
      role: "assistant",
      timestamp: firstAssistantEntry.timestamp,
      turnStatus: null,
      type: "message"
    };

    const cleanFirstUserItem: AgentTranscriptViewItem = {
      ...staleUserItem,
      turnStatus: null
    };

    const secondUserItem: AgentTranscriptViewItem = {
      activities: [],
      changeActivities: [],
      entry: secondUserEntry,
      key: "message:user-2",
      role: "user",
      timestamp: secondUserEntry.timestamp,
      turnStatus: null,
      type: "message"
    };

    const secondAssistantItem: AgentTranscriptViewItem = {
      activities: [],
      changeActivities: [],
      entry: secondAssistantEntry,
      key: "message:assistant-2",
      role: "assistant",
      timestamp: secondAssistantEntry.timestamp,
      turnStatus: null,
      type: "message"
    };

    const current = createSessionDetail({
      transcriptView: createTranscriptView({
        items: [
          staleUserItem,
          { activity: details, key: details.id, type: "activity" },
          firstAssistantItem
        ]
      })
    });
    const terminal = createSessionDetail({
      transcriptView: createTranscriptView({
        items: [
          cleanFirstUserItem,
          firstAssistantItem,
          secondUserItem,
          secondAssistantItem
        ],
        updatedAt: "2026-07-17T10:01:03.000Z"
      }),
      updatedAt: "2026-07-17T10:01:03.000Z"
    });

    const merged = mergeAgentSessionDetail(current, terminal);
    const firstUser = merged.transcriptView?.items.find(
      (item) => item.type === "message" && item.key === "message:user-1"
    );

    assert.equal(firstUser?.type, "message");
    assert.equal(firstUser?.turnStatus, null);
    assert.equal(
      merged.transcriptView?.items.some((item) => item.type === "activity" && item.key === details.id),
      false
    );
  });

  it("retains unrelated history while dropping a reparented standalone activity", () => {
    const historyEntry = {
      ...createEntry("entry:history", "orphaned earlier output", "2026-07-17T09:59:00.000Z"),
      role: "tool" as const
    };

    const currentEntry = {
      ...createEntry("entry:current", "current output", "2026-07-17T10:00:01.000Z"),
      role: "tool" as const
    };

    const assistantEntry = createEntry(
      "entry:assistant",
      "done",
      "2026-07-17T10:00:02.000Z"
    );
    const historyActivity = createActivityGroup("tools:history", [historyEntry]);
    const currentActivity = createActivityGroup("changes:current", [currentEntry], "changes");
    const current = createSessionDetail({
      transcript: [historyEntry, currentEntry],
      transcriptView: createTranscriptView({
        items: [
          { activity: historyActivity, key: historyActivity.id, type: "activity" },
          { activity: currentActivity, key: currentActivity.id, type: "activity" }
        ]
      })
    });
    const terminal = createSessionDetail({
      transcript: [historyEntry, currentEntry, assistantEntry],
      transcriptView: createTranscriptView({
        items: [{
          activities: [],
          changeActivities: [currentActivity],
          entry: assistantEntry,
          key: "message:assistant",
          role: "assistant",
          timestamp: assistantEntry.timestamp,
          turnStatus: null,
          type: "message"
        }],
        updatedAt: "2026-07-17T10:00:03.000Z"
      }),
      updatedAt: "2026-07-17T10:00:03.000Z"
    });
    const historyProtection = {
      entryIds: new Set([historyEntry.id]),
      viewItemKeys: new Set([historyActivity.id])
    };

    const merged = mergeAgentSessionDetail(current, terminal, historyProtection);

    assert.deepEqual(
      merged.transcriptView?.items.map((item) => [item.type, item.key]),
      [
        ["activity", historyActivity.id],
        ["message", "message:assistant"]
      ]
    );
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

  it("lets an authoritative history page clear stale turn status and reparented activity", () => {
    const userEntry = {
      ...createEntry("entry:user", "prompt", "2026-07-17T10:00:00.000Z"),
      role: "user" as const
    };

    const detailEntry = createEntry("entry:detail", "checking", "2026-07-17T10:00:01.000Z");
    const assistantEntry = createEntry(
      "entry:assistant",
      "final",
      "2026-07-17T10:00:02.000Z"
    );
    const details = createActivityGroup("details:turn", [detailEntry], "details");
    const staleUserItem: AgentTranscriptViewItem = {
      activities: [],
      changeActivities: [],
      entry: userEntry,
      key: "message:user",
      role: "user",
      timestamp: userEntry.timestamp,
      turnStatus: {
        kind: "incomplete",
        label: "No final reply",
        title: "The source agent finished before DeskCue received a final reply"
      },
      type: "message"
    };

    const assistantItem: AgentTranscriptViewItem = {
      activities: [details],
      changeActivities: [],
      entry: assistantEntry,
      key: "message:assistant",
      role: "assistant",
      timestamp: assistantEntry.timestamp,
      turnStatus: null,
      type: "message"
    };

    const current = createSessionDetail({
      transcriptView: createTranscriptView({
        items: [staleUserItem, { activity: details, key: details.id, type: "activity" }]
      })
    });
    const pageUserItem: AgentTranscriptViewItem = { ...staleUserItem, turnStatus: null };
    const page = createTranscriptView({ items: [pageUserItem, assistantItem] });

    const merged = mergeAgentSessionTranscriptPage(current, current.id, {
      entries: [userEntry, detailEntry, assistantEntry],
      transcriptView: page
    });
    const mergedUser = merged?.transcriptView?.items.find(
      (item) => item.type === "message" && item.key === staleUserItem.key
    );

    assert.equal(mergedUser?.type, "message");
    assert.equal(mergedUser?.turnStatus, null);
    assert.equal(
      merged?.transcriptView?.items.some(
        (item) => item.type === "activity" && item.key === details.id
      ),
      false
    );

    assert.equal(
      merged?.transcriptView?.items.some(
        (item) => item.type === "message" && item.key === assistantItem.key
      ),
      true
    );
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
