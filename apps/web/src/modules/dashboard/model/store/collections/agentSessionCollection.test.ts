import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AgentKind,
  AgentSessionSummary,
  AgentSessionsResponse
} from "@deskcue/protocol";

import {
  buildAppendedAgentSessionsPagePatch,
  buildAgentSessionsPagePatch,
  buildMergedAgentSessionSummaryPatch
} from "./agentSessionCollection";
import type { AgentSessionCollectionState } from "./agentSessionCollection";

function createSummary(contextCompactionCount: number): AgentSessionSummary {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    cliVersion: null,
    contextCompactionCount,
    filePath: "C:/tmp/session.jsonl",
    id: "codex:session",
    model: null,
    originator: null,
    reviewedAt: null,
    source: null,
    sourceSessionId: "session",
    title: "Regression chat",
    updatedAt: "2026-08-02T15:00:00.000Z",
    workState: "running",
    workspaceName: "DeskCue",
    workspacePath: "D:/projects/example-workspace"
  };
}

function createState(
  sessions: AgentSessionSummary[],
  selectedSourceId: AgentKind | "all" = "all"
): AgentSessionCollectionState & { selectedSourceId: AgentKind | "all" } {
  return {
    activeTakenOverAgentSession: null,
    agentSessions: sessions,
    agentSessionsHasMore: true,
    agentSessionsQuery: null,
    agentSessionsTotalCount: sessions.length,
    agentSessionsTotalCountExact: true,
    agentSessionSourceCounts: [],
    selectedAgentSession: null,
    selectedSourceId
  };
}

describe("agent session collection", () => {
  it("keeps global source counts out of a filtered search page patch", () => {
    const patch = buildAgentSessionsPagePatch({
      hasMore: false,
      limit: 8,
      offset: 0,
      query: "forimex",
      sessions: [createSummary(0)],
      sourceCounts: [{ agentId: "codex", count: 24, exact: true }],
      totalCount: 24,
      totalCountExact: true
    });

    assert.equal(patch.agentSessionSourceCounts, undefined);
  });

  it("refreshes global source counts from an unfiltered source page", () => {
    const sourceCounts = [
      { agentId: "codex" as const, count: 570, exact: true },
      { agentId: "claude-code" as const, count: 26, exact: true }
    ];
    const patch = buildAgentSessionsPagePatch({
      hasMore: true,
      limit: 88,
      offset: 0,
      query: null,
      sessions: [createSummary(0)],
      sourceCounts,
      totalCount: 596,
      totalCountExact: true
    });

    assert.deepEqual(patch.agentSessionSourceCounts, sourceCounts);
  });

  it("does not lower a known context-compaction count from a stale summary", () => {
    const patch = buildAppendedAgentSessionsPagePatch(
      [createSummary(8)],
      {
        hasMore: false,
        limit: 1,
        offset: 0,
        query: null,
        sessions: [createSummary(0)],
        sourceCounts: [],
        totalCount: 1,
        totalCountExact: true
      } satisfies AgentSessionsResponse
    );

    assert.equal(patch.agentSessions?.[0]?.contextCompactionCount, 8);
  });

  it("keeps a known model when a later discovery page omits it", () => {
    const known = { ...createSummary(0), model: "gpt-5.6-terra" };
    const missing = { ...createSummary(0), model: null };
    const patch = buildAppendedAgentSessionsPagePatch(
      [known],
      {
        hasMore: false,
        limit: 1,
        offset: 0,
        query: null,
        sessions: [missing],
        sourceCounts: [],
        totalCount: 1,
        totalCountExact: true
      } satisfies AgentSessionsResponse
    );

    assert.equal(patch.agentSessions?.[0]?.model, "gpt-5.6-terra");
  });

  it("does not let an older live summary regress model or work state", () => {
    const current = {
      ...createSummary(4),
      model: "gpt-5.6-terra",
      updatedAt: "2026-08-06T10:01:00.000Z",
      workState: "idle" as const
    };

    const stale = {
      ...createSummary(0),
      model: null,
      updatedAt: "2026-08-06T10:00:00.000Z",
      workState: "running" as const
    };

    const patch = buildMergedAgentSessionSummaryPatch(createState([current]), stale);

    assert.equal(patch, null);
    assert.equal(current.model, "gpt-5.6-terra");
    assert.equal(current.contextCompactionCount, 4);
    assert.equal(current.workState, "idle");
  });

  it("keeps known model and compaction metadata on a newer live summary", () => {
    const current = {
      ...createSummary(4),
      model: "gpt-5.6-terra",
      updatedAt: "2026-08-06T10:00:00.000Z"
    };

    const incoming = {
      ...createSummary(0),
      model: null,
      updatedAt: "2026-08-06T10:01:00.000Z",
      workState: "idle" as const
    };

    const patch = buildMergedAgentSessionSummaryPatch(createState([current]), incoming);

    assert.equal(patch?.agentSessions?.[0]?.model, "gpt-5.6-terra");
    assert.equal(patch?.agentSessions?.[0]?.contextCompactionCount, 4);
  });

  it("keeps another provider out of the active source window", () => {
    const claude = {
      ...createSummary(0),
      agentId: "claude-code" as const,
      agentLabel: "Claude Code",
      id: "claude-code:session-1",
      sourceSessionId: "session-1"
    };

    const codex = {
      ...createSummary(0),
      id: "codex:session-2",
      sourceSessionId: "session-2"
    };

    const state = {
      ...createState([claude], "claude-code"),
      agentSessionSourceCounts: [
        { agentId: "claude-code" as const, count: 1, exact: true },
        { agentId: "codex" as const, count: 20, exact: true }
      ]
    };

    const patch = buildMergedAgentSessionSummaryPatch(state, codex);

    assert.deepEqual(patch?.agentSessions, [claude]);
    assert.equal(patch?.agentSessionsTotalCount, state.agentSessionsTotalCount);
    assert.equal(patch?.agentSessionsTotalCountExact, true);
    assert.deepEqual(patch?.agentSessionSourceCounts, state.agentSessionSourceCounts);
  });

  it("keeps a live subagent out of the root chat window without changing root counts", () => {
    const root = createSummary(0);
    const child = {
      ...createSummary(0),
      id: "codex:child",
      sourceSessionId: "child",
      subagent: {
        depth: 1,
        nickname: "Scout",
        parentSessionId: root.id,
        role: null
      },
      updatedAt: "2026-08-06T10:02:00.000Z"
    };

    const state = createState([root]);

    const patch = buildMergedAgentSessionSummaryPatch(state, child);

    assert.deepEqual(patch?.agentSessions, [root]);
    assert.equal(patch?.agentSessionsTotalCount, 1);
  });

  it("adds a matching live subagent to an explicit search window", () => {
    const child = {
      ...createSummary(0),
      id: "codex:child",
      sourceSessionId: "child",
      subagent: {
        depth: 1,
        nickname: "Scout",
        parentSessionId: "codex:parent",
        role: null
      },
      updatedAt: "2026-08-06T10:02:00.000Z"
    };

    const state = {
      ...createState([]),
      agentSessionsHasMore: false,
      agentSessionsQuery: "scout"
    };

    const patch = buildMergedAgentSessionSummaryPatch(state, child);

    assert.deepEqual(patch?.agentSessions?.map((session) => session.id), ["codex:child"]);
    assert.equal(patch?.agentSessionsTotalCount, 1);
  });

  it("keeps exact counts stable for an unseen active-scope live summary", () => {
    const current = createSummary(0);
    const incoming = {
      ...createSummary(0),
      id: "codex:off-page",
      sourceSessionId: "off-page",
      updatedAt: "2026-08-06T10:02:00.000Z"
    };

    const state = {
      ...createState([current]),
      agentSessionsTotalCount: 100,
      agentSessionSourceCounts: [{ agentId: "codex" as const, count: 90, exact: true }]
    };

    const patch = buildMergedAgentSessionSummaryPatch(state, incoming);

    assert.equal(patch?.agentSessionsTotalCount, 100);
    assert.equal(patch?.agentSessionsTotalCountExact, true);
    assert.equal(patch?.agentSessions?.length, 1);
    assert.equal(patch?.agentSessions?.[0]?.id, "codex:off-page");
    assert.deepEqual(patch?.agentSessionSourceCounts, [
      { agentId: "codex", count: 90, exact: true }
    ]);
  });

  it("updates the scoped exact count when a live summary enters a fully loaded search", () => {
    const current = {
      ...createSummary(0),
      title: "matching prompt"
    };

    const incoming = {
      ...current,
      id: "codex:new-match",
      sourceSessionId: "new-match",
      updatedAt: "2026-08-06T10:02:00.000Z"
    };

    const state = {
      ...createState([current]),
      agentSessionsHasMore: false,
      agentSessionsQuery: "matching",
      agentSessionSourceCounts: [{ agentId: "codex" as const, count: 20, exact: true }]
    };

    const patch = buildMergedAgentSessionSummaryPatch(state, incoming);

    assert.equal(patch?.agentSessions?.length, 2);
    assert.equal(patch?.agentSessionsTotalCount, 2);
    assert.equal(patch?.agentSessionsTotalCountExact, true);
    assert.deepEqual(patch?.agentSessionSourceCounts, state.agentSessionSourceCounts);
  });

  it("updates the scoped exact count when a live summary leaves the active search", () => {
    const current = {
      ...createSummary(0),
      title: "matching prompt"
    };

    const incoming = {
      ...current,
      title: "renamed chat",
      updatedAt: "2026-08-06T10:02:00.000Z"
    };

    const state = {
      ...createState([current]),
      agentSessionsQuery: "matching",
      agentSessionsTotalCount: 3,
      agentSessionSourceCounts: [{ agentId: "codex" as const, count: 2, exact: true }]
    };

    const patch = buildMergedAgentSessionSummaryPatch(state, incoming);

    assert.deepEqual(patch?.agentSessions, []);
    assert.equal(patch?.agentSessionsTotalCount, 2);
    assert.equal(patch?.agentSessionsTotalCountExact, true);
    assert.deepEqual(patch?.agentSessionSourceCounts, state.agentSessionSourceCounts);
  });
});
