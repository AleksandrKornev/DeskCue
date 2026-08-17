import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AgentSessionDetail,
  AgentTranscriptActivityGroup,
  AgentTranscriptEntry,
  AgentTranscriptViewItem,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";
import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import type { AgentSessionTranscriptUpdatesResponse } from "@api/endpoint/agentSessions/types";
import type { ConditionalJsonResult } from "@api/transport/requests";
import {
  AGENT_SESSION_DETAIL_CHAT_MESSAGE_TAIL,
  AGENT_SESSION_LIVE_SUMMARY_CHAT_MESSAGE_TAIL
} from "@modules/dashboard/model/data/dashboardConstants";

import {
  buildAgentChatDetailFetchOptions,
  readAgentChatDetail,
  resolveAgentChatTranscriptDetail
} from "./agentChatDetailRequests";

async function withPatchedAgentSessionsApi<T>(
  overrides: Partial<typeof agentSessionsApi>,
  run: () => Promise<T>
) {
  const original = { ...agentSessionsApi };
  Object.assign(agentSessionsApi, overrides);

  try {
    return await run();
  } finally {
    Object.assign(agentSessionsApi, original);
  }
}

function createAgentSessionDetail(options: {
  id?: string;
  transcriptView?: AgentTranscriptViewResponse;
  updatedAt?: string;
} = {}): AgentSessionDetail {
  const id = options.id ?? "agent-1";
  const updatedAt = options.updatedAt ?? options.transcriptView?.updatedAt ?? "2026-07-26T10:00:00.000Z";

  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    cliVersion: null,
    filePath: "codex.jsonl",
    id,
    model: null,
    originator: null,
    reviewedAt: null,
    source: null,
    sourceSessionId: "source-1",
    title: "Agent chat",
    transcript: [],
    transcriptView: options.transcriptView,
    updatedAt,
    workspaceName: null,
    workspacePath: null,
    workState: "idle"
  };
}

function createTranscriptView(
  items: AgentTranscriptViewItem[],
  updatedAt = "2026-07-26T10:00:00.000Z"
): AgentTranscriptViewResponse {
  return {
    items,
    latestWaitingDetailEntry: null,
    sessionId: "agent-1",
    updatedAt
  };
}

function createTranscriptEntry(
  id: string,
  role: "user" | "assistant",
  timestamp: string
): AgentTranscriptEntry {
  return {
    id,
    phase: null,
    role,
    text: id,
    timestamp
  };
}

function createMessageItem(
  id: string,
  role: "user" | "assistant",
  timestamp = "2026-07-26T10:00:00.000Z"
): AgentTranscriptViewItem {
  const entry = createTranscriptEntry(id, role, timestamp);

  return {
    activities: [],
    changeActivities: [],
    entry,
    key: id,
    role,
    timestamp,
    turnStatus: null,
    type: "message"
  };
}

function createActivityItem(
  options: Partial<AgentTranscriptActivityGroup> & Pick<AgentTranscriptActivityGroup, "id" | "kind">
): AgentTranscriptViewItem {
  const activity: AgentTranscriptActivityGroup = {
    entries: [],
    entryIds: [],
    label: options.kind === "changes" ? "Changes (1)" : "Tools (1)",
    timestamp: "2026-07-26T10:00:00.000Z",
    ...options
  };

  return {
    activity,
    key: activity.id,
    type: "activity"
  };
}

function createResult<TData>(data: TData): ConditionalJsonResult<TData> {
  return {
    data,
    etag: null,
    notModified: false,
    status: 200
  };
}

describe("agent chat detail requests", () => {
  it("uses summary transcript detail only for overview when requested", () => {
    assert.equal(
      resolveAgentChatTranscriptDetail("overview", { summaryOnOverview: true }),
      "summary"
    );
    assert.equal(
      resolveAgentChatTranscriptDetail("activity", { summaryOnOverview: true }),
      "full"
    );
    assert.equal(
      resolveAgentChatTranscriptDetail("overview", { summaryOnOverview: false }),
      "full"
    );
  });

  it("builds bounded overview summary fetch options", () => {
    const signal = new AbortController().signal;

    assert.deepEqual(
      buildAgentChatDetailFetchOptions({
        activeTab: "overview",
        minimumUpdatedAt: "2026-07-17T10:00:00.000Z",
        signal,
        transcriptDetail: "summary"
      }),
      {
        chatMessageTail: AGENT_SESSION_LIVE_SUMMARY_CHAT_MESSAGE_TAIL,
        includeTranscriptView: true,
        minimumUpdatedAt: "2026-07-17T10:00:00.000Z",
        signal,
        transcriptDetail: "summary"
      }
    );
  });

  it("does not request transcript view for full transcript detail", () => {
    assert.deepEqual(
      buildAgentChatDetailFetchOptions({
        activeTab: "activity",
        transcriptDetail: "full"
      }),
      {
        chatMessageTail: AGENT_SESSION_DETAIL_CHAT_MESSAGE_TAIL,
        includeTranscriptView: false,
        minimumUpdatedAt: undefined,
        signal: undefined,
        transcriptDetail: "full"
      }
    );
  });

  it("uses transcript view for summary activity and diff tabs", () => {
    assert.deepEqual(
      buildAgentChatDetailFetchOptions({
        activeTab: "activity",
        transcriptDetail: "summary"
      }),
      {
        chatMessageTail: AGENT_SESSION_LIVE_SUMMARY_CHAT_MESSAGE_TAIL,
        includeTranscriptView: true,
        minimumUpdatedAt: undefined,
        signal: undefined,
        transcriptDetail: "summary"
      }
    );
    assert.deepEqual(
      buildAgentChatDetailFetchOptions({
        activeTab: "diff",
        transcriptDetail: "summary"
      }),
      {
        chatMessageTail: AGENT_SESSION_LIVE_SUMMARY_CHAT_MESSAGE_TAIL,
        includeTranscriptView: true,
        minimumUpdatedAt: undefined,
        signal: undefined,
        transcriptDetail: "summary"
      }
    );
  });

  it("keeps summary logs metadata-only", () => {
    assert.deepEqual(
      buildAgentChatDetailFetchOptions({
        activeTab: "logs",
        transcriptDetail: "summary"
      }),
      {
        chatMessageTail: AGENT_SESSION_LIVE_SUMMARY_CHAT_MESSAGE_TAIL,
        includeTranscriptView: false,
        minimumUpdatedAt: undefined,
        omitTranscript: true,
        signal: undefined,
        transcriptDetail: "summary"
      }
    );
  });

  it("uses transcript updates for live summary refreshes with a base view", async () => {
    const baseDetail = createAgentSessionDetail({
      transcriptView: createTranscriptView([
        createMessageItem("entry-1", "user"),
        createMessageItem("entry-2", "assistant")
      ])
    });
    let updatesRequestCount = 0;

    await withPatchedAgentSessionsApi({
      getTranscriptUpdatesWithMeta: (agentSessionId, options) => {
        updatesRequestCount += 1;
        assert.equal(agentSessionId, "agent-1");
        assert.equal(options?.baseItemKey, "entry-2");
        assert.equal(options?.baseSourceEntryId, "entry-2");
        assert.equal(options?.overlapItemCount, 4);
        assert.equal(options?.includeSessionSummary, false);

        return Promise.resolve(createResult<AgentSessionTranscriptUpdatesResponse>({
          ...createTranscriptView(
            [
              createMessageItem("entry-2", "assistant"),
              createMessageItem("entry-3", "assistant", "2026-07-26T10:01:00.000Z")
            ],
            "2026-07-26T10:01:00.000Z"
          ),
          replaceFromItemKey: "entry-2"
        }));
      },
      getTranscriptViewWithMeta: () => Promise.reject(new Error("Expected transcript-updates request")),
      getOne: () => Promise.reject(new Error("Expected transcript-updates request"))
    }, async () => {
      const result = await readAgentChatDetail("agent-1", {
        activeTab: "overview",
        baseDetail,
        minimumUpdatedAt: "2026-07-26T10:01:00.000Z",
        transcriptDetail: "summary"
      });

      assert.equal(updatesRequestCount, 1);
      assert.equal(result.detail?.updatedAt, "2026-07-26T10:01:00.000Z");
      assert.deepEqual(
        result.detail?.transcriptView?.items.map((item) => item.key),
        ["entry-1", "entry-2", "entry-3"]
      );
    });
  });

  it("uses the latest activity source entry as the live summary refresh cursor", async () => {
    const baseDetail = createAgentSessionDetail({
      transcriptView: createTranscriptView([
        createMessageItem("entry-1", "user"),
        createActivityItem({
          id: "tools-hash",
          kind: "tools",
          sourceEntryRanges: [
            {
              prefix: "entry-",
              start: 2,
              end: 7
            }
          ]
        })
      ])
    });
    let updatesRequestCount = 0;

    await withPatchedAgentSessionsApi({
      getTranscriptUpdatesWithMeta: (_agentSessionId, options) => {
        updatesRequestCount += 1;
        assert.equal(options?.baseItemKey, "tools-hash");
        assert.equal(options?.baseSourceEntryId, "entry-7");

        return Promise.resolve(createResult<AgentSessionTranscriptUpdatesResponse>({
          ...createTranscriptView(
            [
              createActivityItem({
                id: "tools-new-hash",
                kind: "tools",
                sourceEntryRanges: [
                  {
                    prefix: "entry-",
                    start: 2,
                    end: 8
                  }
                ]
              })
            ],
            "2026-07-26T10:01:00.000Z"
          ),
          replaceFromItemKey: "tools-hash"
        }));
      },
      getTranscriptViewWithMeta: () => Promise.reject(new Error("Expected transcript-updates request")),
      getOne: () => Promise.reject(new Error("Expected transcript-updates request"))
    }, async () => {
      await readAgentChatDetail("agent-1", {
        activeTab: "overview",
        baseDetail,
        minimumUpdatedAt: "2026-07-26T10:01:00.000Z",
        transcriptDetail: "summary"
      });

      assert.equal(updatesRequestCount, 1);
    });
  });

  it("keeps tab switches on the full transcript view endpoint", async () => {
    const baseDetail = createAgentSessionDetail({
      transcriptView: createTranscriptView([
        createMessageItem("entry-1", "user"),
        createMessageItem("entry-2", "assistant")
      ])
    });
    let viewRequestCount = 0;

    await withPatchedAgentSessionsApi({
      getTranscriptUpdatesWithMeta: () => Promise.reject(new Error("Did not expect transcript-updates request")),
      getTranscriptViewWithMeta: (_agentSessionId, options) => {
        viewRequestCount += 1;
        assert.equal(options?.baseItemKey, undefined);
        assert.equal(options?.includeSessionSummary, false);

        return Promise.resolve(createResult(createTranscriptView([
          createMessageItem("entry-1", "user"),
          createMessageItem("entry-2", "assistant")
        ])));
      }
    }, async () => {
      const result = await readAgentChatDetail("agent-1", {
        activeTab: "activity",
        baseDetail,
        transcriptDetail: "summary"
      });

      assert.equal(viewRequestCount, 1);
      assert.equal(result.detail?.id, "agent-1");
    });
  });
});
