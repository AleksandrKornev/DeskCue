import { describe, expect, it } from "vitest";

import type { SessionSummary } from "@deskcue/protocol";

import {
  buildAgentSessionsUnifiedListModel,
  selectAttachedSourceSessionKeys
} from "./helpers";

function session(
  id: string,
  adapterId: string,
  sourceSessionId: string | null,
  status: SessionSummary["status"]
) {
  return {
    adapterId,
    id,
    sourceSessionId,
    status
  } as SessionSummary;
}

describe("agent sessions unified list model", () => {
  it("combines source and local counts without exposing hidden local rows", () => {
    const model = buildAgentSessionsUnifiedListModel({
      agentSessionsCount: 8,
      agentSessionsHasMore: true,
      agentSessionsLoadState: "ready",
      canLoadMoreSessions: true,
      canShowFewerSessions: true,
      filteredAgentSessionsCount: 8,
      filteredLocalChatsCount: 2,
      hiddenAgentSessionsCount: 3,
      isLoadingMoreSessions: false,
      isSearchLoading: false,
      isSourceSwitching: false,
      localChatsCount: 5,
      queryMatchedLocalChatsCount: 2,
      query: "",
      selectedLocalRuntime: null,
      selectedSourceId: "all",
      sourceCards: [],
      totalAgentSessionsCount: "100"
    });

    expect(model.allChatsCount).toBe("105");
    expect(model.filteredSessionsCount).toBe(10);
    expect(model.hiddenSessionsCount).toBe(5);
    expect(model.selectedSourceSessionsCount).toBe("105");
  });

  it("treats a local-only query as complete instead of loading agent pages", () => {
    const model = buildAgentSessionsUnifiedListModel({
      agentSessionsCount: 8,
      agentSessionsHasMore: true,
      agentSessionsLoadState: "ready",
      canLoadMoreSessions: true,
      canShowFewerSessions: true,
      filteredAgentSessionsCount: 0,
      filteredLocalChatsCount: 1,
      hiddenAgentSessionsCount: 3,
      isLoadingMoreSessions: false,
      isSearchLoading: false,
      isSourceSwitching: false,
      localChatsCount: 1,
      queryMatchedLocalChatsCount: 1,
      query: "qwen",
      selectedLocalRuntime: null,
      selectedSourceId: "all",
      sourceCards: [],
      totalAgentSessionsCount: "0"
    });

    expect(model.allChatsCount).toBe("1");
    expect(model.canLoadMoreSessions).toBe(false);
    expect(model.hiddenSessionsCount).toBe(3);
    expect(model.isListLoading).toBe(false);
  });

  it("indexes only running attached source sessions", () => {
    const keys = selectAttachedSourceSessionKeys([
      session("managed-1", "codex", "source-1", "running"),
      session("managed-2", "claude-code", "source-2", "done"),
      session("managed-3", "codex", null, "running")
    ]);

    expect([...keys]).toEqual(["codex:source-1"]);
  });

  it("preserves inexact totals and never renders NaN while local chats are added", () => {
    const inexact = buildAgentSessionsUnifiedListModel({
      agentSessionsCount: 8,
      agentSessionsHasMore: true,
      agentSessionsLoadState: "ready",
      canLoadMoreSessions: true,
      canShowFewerSessions: false,
      filteredAgentSessionsCount: 8,
      filteredLocalChatsCount: 2,
      hiddenAgentSessionsCount: 0,
      isLoadingMoreSessions: false,
      isSearchLoading: false,
      isSourceSwitching: false,
      localChatsCount: 12,
      queryMatchedLocalChatsCount: 12,
      query: "",
      selectedLocalRuntime: null,
      selectedSourceId: "all",
      sourceCards: [],
      totalAgentSessionsCount: "315+"
    });
    const pending = buildAgentSessionsUnifiedListModel({
      ...{
        agentSessionsCount: 0,
        agentSessionsHasMore: false,
        agentSessionsLoadState: "loading" as const,
        canLoadMoreSessions: false,
        canShowFewerSessions: false,
        filteredAgentSessionsCount: 0,
        filteredLocalChatsCount: 0,
        hiddenAgentSessionsCount: 0,
        isLoadingMoreSessions: false,
        isSearchLoading: false,
        isSourceSwitching: false,
        localChatsCount: 12,
        queryMatchedLocalChatsCount: 12,
        query: "",
        selectedLocalRuntime: null,
        selectedSourceId: "all" as const,
        sourceCards: [],
        totalAgentSessionsCount: "..."
      }
    });

    expect(inexact.allChatsCount).toBe("327+");
    expect(pending.allChatsCount).toBe("...");
  });
});
