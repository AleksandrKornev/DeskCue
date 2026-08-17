import { describe, expect, it } from "vitest";

import type { LocalLlmChatDetail } from "@deskcue/protocol";

import {
  canApplyLocalLlmRefresh,
  canCommitLocalLlmMutation,
  createLocalLlmDetailRefreshState,
  getLmStudioPromptBlockReason
} from "./controllers/helpers";
import {
  buildLocalSessionAdapter,
  toLocalLlmTranscript
} from "./localLlmManagedSessionAdapter";
import {
  groupLocalLlmTurnActivities,
  localLlmInterruptedUserMessageIds,
  localLlmLatestWaitingDetailEntry,
  localLlmWaitingPrompt,
  LOCAL_LLM_RUNNING_REFRESH_INTERVAL_MS,
  localLlmChatRefreshInterval,
  mergeLocalChatDetail
} from "./localLlmManagedSessionTranscript";

const initialDetail: LocalLlmChatDetail = {
  actionRequests: [],
  agentMode: "read_only",
  changeSets: [],
  createdAt: "2026-08-03T10:00:00.000Z",
  events: [],
  generationError: null,
  generationState: "idle",
  history: {
    changeSets: { hasMore: true, nextCursor: "change-page-2" },
    events: { hasMore: true, nextCursor: "event-page-2" },
    messages: { hasMore: true, nextCursor: "message-page-2" }
  },
  id: "chat-1",
  messages: [],
  model: "test-model",
  pendingAssistantText: null,
  pendingLmStudioPrompt: null,
  runtimeId: "ollama",
  title: "Test chat",
  toolCapability: null,
  updatedAt: "2026-08-03T10:00:00.000Z",
  workspace: null
};

describe("local LLM managed session transcript", () => {
  it("projects the chat-specific preview network mode into the managed session", () => {
    const adapter = buildLocalSessionAdapter({
      ...initialDetail,
      preview: {
        active: true,
        networkMode: "deskcue-host",
        port: 5173,
        targetUrl: "http://127.0.0.1:5173"
      }
    }, null);

    expect(adapter.session.preview.networkMode).toBe("deskcue-host");
  });

  it("projects the attached workspace git snapshot into the managed session", () => {
    const git = {
      branch: "main",
      changedFiles: ["README.md"],
      diff: "diff --git a/README.md b/README.md",
      isDirty: true,
      isGitRepo: true,
      lastUpdatedAt: "2026-08-03T10:01:00.000Z"
    };
    const adapter = buildLocalSessionAdapter({
      ...initialDetail,
      git
    }, null);

    expect(adapter.session.git).toEqual(git);
  });

  it("uses a slow recovery watchdog only while local generation is active", () => {
    expect(localLlmChatRefreshInterval("running")).toBe(LOCAL_LLM_RUNNING_REFRESH_INTERVAL_MS);
    expect(localLlmChatRefreshInterval("idle")).toBeNull();
    expect(localLlmChatRefreshInterval("waiting_approval")).toBeNull();
    expect(localLlmChatRefreshInterval(undefined)).toBeNull();
  });

  it("does not turn normal lifecycle facts into Details cards", () => {
    const activities = groupLocalLlmTurnActivities([
      { id: "started", timestamp: "2026-08-03T10:00:00.000Z", turnId: "turn-1", type: "turn_started" },
      { id: "saved", messageId: "assistant-1", timestamp: "2026-08-03T10:00:01.000Z", turnId: "turn-1", type: "assistant_message_saved" },
      { id: "completed", timestamp: "2026-08-03T10:00:02.000Z", turnId: "turn-1", type: "turn_completed" }
    ]);

    expect(activities.byTurnId.has("turn-1")).toBe(false);
    expect(activities.unanchored).toEqual([]);
  });

  it("shows runtime-exposed reasoning as a Details entry for the completed turn", () => {
    const activities = groupLocalLlmTurnActivities([{
      id: "reasoning",
      messageId: "assistant-1",
      summary: "I should inspect the workspace first.",
      timestamp: "2026-08-03T10:00:01.000Z",
      turnId: "turn-1",
      type: "model_reasoning_saved"
    }]);

    expect(activities.byTurnId.get("turn-1")).toMatchObject([{
      kind: "details",
      label: "Details (1)",
      entries: [{ text: "I should inspect the workspace first." }]
    }]);
  });

  it("coalesces one requested and completed tool call into one Tools group", () => {
    const activities = groupLocalLlmTurnActivities([
      { id: "started", timestamp: "2026-08-03T10:00:00.000Z", turnId: "turn-1", type: "turn_started" },
      {
        id: "requested",
        timestamp: "2026-08-03T10:00:01.000Z",
        toolCallId: "tool-1",
        toolName: "run_workspace_command",
        turnId: "turn-1",
        type: "tool_requested"
      },
      {
        id: "completed",
        summary: "Command node finished.",
        timestamp: "2026-08-03T10:00:02.000Z",
        toolCallId: "tool-1",
        toolName: "run_workspace_command",
        turnId: "turn-1",
        type: "tool_completed"
      },
      { id: "saved", messageId: "assistant-1", timestamp: "2026-08-03T10:00:03.000Z", turnId: "turn-1", type: "assistant_message_saved" },
      { id: "complete", timestamp: "2026-08-03T10:00:04.000Z", turnId: "turn-1", type: "turn_completed" }
    ]);

    expect(activities.byTurnId.get("turn-1")).toMatchObject([{
      kind: "tools",
      label: "Tools (1)",
      entries: [{ text: "Command node finished" }]
    }]);
  });

  it("projects the active local turn into the generic waiting-detail contract", () => {
    const detail: LocalLlmChatDetail = {
      ...initialDetail,
      events: [{ id: "started", timestamp: "2026-08-03T10:00:01.000Z", turnId: "turn-1", type: "turn_started" }],
      generationState: "running",
      pendingAssistantText: "Working through the workspace",
      updatedAt: "2026-08-03T10:00:02.000Z"
    };

    expect(localLlmLatestWaitingDetailEntry(detail)).toMatchObject({
      role: "commentary",
      text: "Working through the workspace"
    });
    expect(localLlmLatestWaitingDetailEntry({ ...detail, pendingAssistantText: null })).toMatchObject({
      text: "DeskCue started local model generation"
    });
    expect(localLlmLatestWaitingDetailEntry({
      ...detail,
      pendingAssistantText: null,
      events: [
        ...detail.events,
        {
          id: "tool-requested",
          timestamp: "2026-08-03T10:00:03.000Z",
          toolName: "list_workspace_files",
          turnId: "turn-1",
          type: "tool_requested"
        }
      ]
    })).toMatchObject({
      text: "Local agent requested list_workspace_files"
    });
    expect(localLlmLatestWaitingDetailEntry({ ...detail, generationState: "idle" })).toBeNull();
  });

  it("keeps a running local response in the waiting block instead of a transient assistant message", () => {
    const detail: LocalLlmChatDetail = {
      ...initialDetail,
      events: [{
        id: "started",
        messageId: "user-1",
        timestamp: "2026-08-03T10:00:01.000Z",
        turnId: "turn-1",
        type: "turn_started"
      }],
      generationState: "running",
      messages: [{
        id: "user-1",
        role: "user",
        status: "complete",
        text: "Please continue",
        timestamp: "2026-08-03T10:00:01.000Z"
      }],
      pendingAssistantText: "Thinking through the task"
    };

    expect(toLocalLlmTranscript(detail)).toHaveLength(1);
    expect(localLlmWaitingPrompt(detail)).toEqual({
      requestedAt: "2026-08-03T10:00:01.000Z",
      text: "Please continue"
    });
  });

  it("keeps an empty assistant checkpoint in the waiting block instead of inventing a bubble", () => {
    const detail: LocalLlmChatDetail = {
      ...initialDetail,
      events: [{
        id: "started",
        messageId: "user-1",
        timestamp: "2026-08-03T10:00:01.000Z",
        turnId: "turn-1",
        type: "turn_started"
      }],
      generationState: "running",
      messages: [
        {
          id: "user-1",
          role: "user",
          status: "complete",
          text: "Please continue",
          timestamp: "2026-08-03T10:00:01.000Z"
        },
        {
          id: "assistant-empty",
          role: "assistant",
          status: "interrupted",
          text: "",
          timestamp: "2026-08-03T10:00:02.000Z"
        }
      ],
      pendingAssistantText: null
    };

    expect(toLocalLlmTranscript(detail).map((entry) => entry.role)).toEqual(["user"]);
    expect(localLlmLatestWaitingDetailEntry(detail)).toMatchObject({
      text: "DeskCue started local model generation"
    });
  });

  it("marks the originating user prompt when a local turn is interrupted", () => {
    expect(localLlmInterruptedUserMessageIds([
      {
        id: "started",
        messageId: "user-1",
        timestamp: "2026-08-03T10:00:01.000Z",
        turnId: "turn-1",
        type: "turn_started"
      },
      {
        id: "interrupted",
        timestamp: "2026-08-03T10:00:02.000Z",
        turnId: "turn-1",
        type: "turn_interrupted"
      }
    ])).toEqual(new Set(["user-1"]));
  });

  it("blocks a DeskCue-owned LM Studio prompt until its server and model are ready", () => {
    expect(getLmStudioPromptBlockReason("lm-studio", null)).toBe("server_off");
    expect(getLmStudioPromptBlockReason("lm-studio", {
      endpoint: "http://127.0.0.1:1234",
      id: "lm-studio",
      installed: true,
      label: "LM Studio",
      lastActiveModel: null,
      loadedModelCount: 0,
      modelCount: 36,
      running: true,
      statusText: "0 loaded, 36 local models"
    })).toBe("model_unloaded");
    expect(getLmStudioPromptBlockReason("lm-studio", {
      endpoint: "http://127.0.0.1:1234",
      id: "lm-studio",
      installed: true,
      label: "LM Studio",
      lastActiveModel: "openai/gpt-oss-20b",
      loadedModelCount: 1,
      modelCount: 36,
      running: true,
      statusText: "1 loaded, 36 local models"
    })).toBeNull();
    expect(getLmStudioPromptBlockReason("ollama", null)).toBeNull();
  });

  it("keeps an advanced older-history cursor while polling the newest page", () => {
    const pageAfterLoad: LocalLlmChatDetail = {
      ...initialDetail,
      history: {
        changeSets: { hasMore: false, nextCursor: null },
        events: { hasMore: true, nextCursor: "event-page-3" },
        messages: { hasMore: true, nextCursor: "message-page-3" }
      }
    };
    const newestPollingPage: LocalLlmChatDetail = {
      ...initialDetail,
      history: {
        changeSets: { hasMore: true, nextCursor: "change-page-2" },
        events: { hasMore: true, nextCursor: "event-page-2" },
        messages: { hasMore: true, nextCursor: "message-page-2" }
      },
      updatedAt: "2026-08-03T10:03:00.000Z"
    };

    expect(mergeLocalChatDetail(pageAfterLoad, newestPollingPage, {
      preserveHistoryFor: new Set(["messages", "events", "changeSets"])
    }).history).toEqual(pageAfterLoad.history);
  });

  it("reuses an equivalent poll snapshot instead of rerendering the chat timeline", () => {
    const current: LocalLlmChatDetail = {
      ...initialDetail,
      events: [{ id: "started", timestamp: "2026-08-03T10:00:01.000Z", turnId: "turn-1", type: "turn_started" }],
      generationState: "running"
    };
    const incoming: LocalLlmChatDetail = {
      ...current,
      events: [...current.events],
      messages: [...current.messages],
      changeSets: [...current.changeSets]
    };

    expect(mergeLocalChatDetail(current, incoming)).toBe(current);
  });

  it("commits a Preview configuration mutation even when the chat timestamp is unchanged", () => {
    const current: LocalLlmChatDetail = {
      ...initialDetail,
      preview: {
        active: false,
        artifacts: [],
        networkMode: "device-direct",
        port: null,
        targetUrl: null
      }
    };
    const incoming: LocalLlmChatDetail = {
      ...current,
      preview: {
        active: true,
        artifacts: [],
        networkMode: "device-direct",
        port: 5173,
        targetUrl: "http://127.0.0.1:5173"
      }
    };

    const merged = mergeLocalChatDetail(current, incoming);

    expect(merged).not.toBe(current);
    expect(merged.preview).toEqual(incoming.preview);
  });

  it("commits a refreshed git snapshot even when the chat timestamp is unchanged", () => {
    const current: LocalLlmChatDetail = {
      ...initialDetail,
      git: {
        branch: "main",
        changedFiles: [],
        diff: "",
        isDirty: false,
        isGitRepo: true,
        lastUpdatedAt: "2026-08-03T10:00:00.000Z"
      }
    };
    const incoming: LocalLlmChatDetail = {
      ...current,
      git: {
        branch: "main",
        changedFiles: ["README.md"],
        diff: "diff --git a/README.md b/README.md",
        isDirty: true,
        isGitRepo: true,
        lastUpdatedAt: "2026-08-03T10:01:00.000Z"
      }
    };

    const merged = mergeLocalChatDetail(current, incoming);

    expect(merged).not.toBe(current);
    expect(merged.git).toEqual(incoming.git);
  });

  it("applies enriched same-id event content instead of leaving Details stale", () => {
    const current: LocalLlmChatDetail = {
      ...initialDetail,
      events: [{
        id: "reasoning",
        summary: "short",
        timestamp: "2026-08-03T10:00:01.000Z",
        turnId: "turn-1",
        type: "model_reasoning_saved"
      }]
    };
    const incoming: LocalLlmChatDetail = {
      ...current,
      events: [{
        ...current.events[0],
        summary: "the complete hydrated reasoning summary"
      }]
    };

    const merged = mergeLocalChatDetail(current, incoming);

    expect(merged).not.toBe(current);
    expect(merged.events[0]?.summary).toBe("the complete hydrated reasoning summary");
  });

  it("does not replace history-hydrated reasoning with a truncated live summary", () => {
    const fullSummary = "complete reasoning ".repeat(1_000);
    const current: LocalLlmChatDetail = {
      ...initialDetail,
      events: [{
        id: "reasoning",
        summary: fullSummary,
        timestamp: "2026-08-03T10:00:01.000Z",
        turnId: "turn-1",
        type: "model_reasoning_saved"
      }]
    };
    const incoming: LocalLlmChatDetail = {
      ...current,
      events: [{
        ...current.events[0],
        summary: "complete reasoning\n\n[Details truncated in the live update]"
      }]
    };

    const merged = mergeLocalChatDetail(current, incoming, {
      preserveHistoryFor: new Set(["events"])
    });

    expect(merged.events[0]?.summary).toBe(fullSummary);
  });

  it("merges an older history page without rolling back the current live shell", () => {
    const current: LocalLlmChatDetail = {
      ...initialDetail,
      generationState: "running",
      pendingAssistantText: "new live answer",
      updatedAt: "2026-08-03T10:10:00.000Z"
    };
    const historyPage: LocalLlmChatDetail = {
      ...initialDetail,
      generationState: "idle",
      messages: [{
        id: "old-user",
        role: "user",
        status: "complete",
        text: "old prompt",
        timestamp: "2026-08-03T09:00:00.000Z"
      }],
      pendingAssistantText: null,
      updatedAt: "2026-08-03T10:00:00.000Z"
    };

    const merged = mergeLocalChatDetail(current, historyPage, {
      preserveCurrentShell: true
    });

    expect(merged.generationState).toBe("running");
    expect(merged.pendingAssistantText).toBe("new live answer");
    expect(merged.updatedAt).toBe(current.updatedAt);
    expect(merged.messages.map((message) => message.id)).toContain("old-user");
  });

  it("keeps a hydrated change-set diff across compact live pages", () => {
    const current: LocalLlmChatDetail = {
      ...initialDetail,
      changeSets: [{
        attribution: "applied_by_deskcue_local_agent",
        changedFiles: ["README.md"],
        diff: "full hydrated patch",
        diffStorage: "gzip_sidecar",
        id: "change-1",
        timestamp: "2026-08-03T10:00:01.000Z",
        turnId: "turn-1"
      }]
    };
    const incoming: LocalLlmChatDetail = {
      ...current,
      changeSets: [{ ...current.changeSets[0], diff: "" }]
    };

    expect(mergeLocalChatDetail(current, incoming).changeSets[0]?.diff)
      .toBe("full hydrated patch");
  });

  it("keeps a long-running live chat bounded while preserving history cursors", () => {
    let current = initialDetail;
    const preservedHistory = new Set(["messages", "events", "changeSets"] as const);
    for (let index = 0; index < 2_000; index += 1) {
      const timestamp = new Date(Date.parse(initialDetail.createdAt) + index * 1_000).toISOString();
      current = mergeLocalChatDetail(current, {
        ...initialDetail,
        events: [{
          id: `event-${index}`,
          summary: `detail-${index}`,
          timestamp,
          turnId: `turn-${index}`,
          type: "model_reasoning_saved"
        }],
        messages: [{
          id: `message-${index}`,
          role: "assistant",
          status: "complete",
          text: `answer-${index}`,
          timestamp
        }],
        updatedAt: timestamp
      }, { preserveHistoryFor: preservedHistory });
    }

    expect(current.messages.length).toBeLessThanOrEqual(256);
    expect(current.events.length).toBeLessThanOrEqual(512);
    expect(current.messages.some((message) => message.id === "message-0")).toBe(false);
    expect(current.messages.at(-1)?.id).toBe("message-1999");
    expect(current.events.at(-1)?.id).toBe("event-1999");
    expect(current.history).toEqual(initialDetail.history);
  });

  it("bounds retained local event payload bytes as well as record count", () => {
    const largeSummary = "x".repeat(128 * 1024);
    const incoming: LocalLlmChatDetail = {
      ...initialDetail,
      events: Array.from({ length: 100 }, (_, index) => ({
        id: `event-${index}`,
        summary: largeSummary,
        timestamp: new Date(Date.parse(initialDetail.createdAt) + index * 1_000).toISOString(),
        turnId: `turn-${index}`,
        type: "model_reasoning_saved" as const
      }))
    };

    const merged = mergeLocalChatDetail(initialDetail, incoming);

    expect(JSON.stringify(merged.events).length * 2).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(merged.events.at(-1)?.id).toBe("event-99");
  });

  it("keeps explicitly loaded history while bounding subsequent live records", () => {
    const liveMessages = Array.from({ length: 256 }, (_, index) => ({
      id: `live-${index}`,
      role: "assistant" as const,
      status: "complete" as const,
      text: `live answer ${index}`,
      timestamp: new Date(Date.parse(initialDetail.createdAt) + index * 1_000).toISOString()
    }));
    const historyMessages = Array.from({ length: 80 }, (_, index) => ({
      id: `history-${index}`,
      role: "assistant" as const,
      status: "complete" as const,
      text: `history answer ${index}`,
      timestamp: new Date(Date.parse(initialDetail.createdAt) - (80 - index) * 1_000).toISOString()
    }));
    const preserveRecordIds = {
      messages: new Set(historyMessages.map((message) => message.id))
    };
    const current = { ...initialDetail, messages: liveMessages };
    const withHistory = mergeLocalChatDetail(current, {
      ...initialDetail,
      messages: historyMessages
    }, {
      preserveCurrentShell: true,
      preserveRecordIds
    });

    const withNewLiveTail = mergeLocalChatDetail(withHistory, {
      ...initialDetail,
      messages: Array.from({ length: 400 }, (_, index) => ({
        id: `next-live-${index}`,
        role: "assistant" as const,
        status: "complete" as const,
        text: `next live answer ${index}`,
        timestamp: new Date(Date.parse(initialDetail.createdAt) + (300 + index) * 1_000)
          .toISOString()
      }))
    }, { preserveRecordIds });

    expect(withHistory.messages.filter((message) => message.id.startsWith("history-")).length)
      .toBe(80);
    expect(withNewLiveTail.messages.filter((message) => message.id.startsWith("history-")).length)
      .toBe(80);
    expect(withNewLiveTail.messages.filter((message) => !message.id.startsWith("history-")).length)
      .toBeLessThanOrEqual(256);
    expect(withNewLiveTail.messages.at(-1)?.id).toBe("next-live-399");
  });

  it("does not let a stale live refresh overwrite a composer mutation", () => {
    const state = createLocalLlmDetailRefreshState("chat-1");
    const refreshRevision = state.mutationRevision;

    expect(canApplyLocalLlmRefresh(state, state, refreshRevision)).toBe(true);

    state.mutationInFlight = true;
    state.mutationRevision += 1;
    expect(canApplyLocalLlmRefresh(state, state, refreshRevision)).toBe(false);

    state.mutationInFlight = false;
    expect(canApplyLocalLlmRefresh(state, state, state.mutationRevision)).toBe(true);
    expect(canApplyLocalLlmRefresh(
      createLocalLlmDetailRefreshState("chat-1"),
      state,
      state.mutationRevision
    )).toBe(false);
  });

  it("rejects an old mutation token after an A-B-A chat switch", () => {
    const firstAState = createLocalLlmDetailRefreshState("chat-a");
    firstAState.mutationInFlight = true;
    firstAState.mutationRevision = 1;
    const oldToken = { revision: 1, state: firstAState };

    const secondAState = createLocalLlmDetailRefreshState("chat-a");
    secondAState.mutationInFlight = true;
    secondAState.mutationRevision = 1;

    expect(canCommitLocalLlmMutation(firstAState, oldToken)).toBe(true);
    expect(canCommitLocalLlmMutation(secondAState, oldToken)).toBe(false);
  });
});
