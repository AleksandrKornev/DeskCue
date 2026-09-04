import type {
  AgentSessionDetail,
  AgentSessionsResponse,
  SessionDetail
} from "@deskcue/protocol";
import type { SessionCommandAccepted } from "@api/endpoint/sessions/types";
import type { ApiErrorPayload } from "@api/transport/errors";
import {
  getConditionalJson,
  getConditionalJsonResult,
  getJson,
  getNullableJson,
  postApi,
  postConditionalJsonResult,
  postJson
} from "@api/transport/requests";
import type { ConditionalJsonResult } from "@api/transport/requests";

import type {
  AgentSessionTranscriptEntriesResponse,
  AgentSessionTranscriptPageResponse,
  AgentSessionChangesResponse,
  FetchAgentSessionChangesOptions,
  FetchAgentSessionOptions,
  FetchAgentSessionsOptions,
  FetchAgentSessionTranscriptPageOptions,
  AgentSessionTranscriptUpdatesResponse,
  AgentSessionTranscriptViewResponse
} from "./types";

function buildAgentSessionScopedUrl(agentSessionId: string, suffix: string) {
  return `/api/agents/sessions/${encodeURIComponent(agentSessionId)}${suffix}`;
}

function shouldPostHydrationRequest(query: URLSearchParams) {
  return query.toString().length > 1500;
}

function buildUncachedConditionalJsonResult<TData>(data: TData): ConditionalJsonResult<TData> {
  return {
    data,
    etag: null,
    notModified: false,
    status: 200
  };
}

function buildAgentSessionRequestUrl(
  agentSessionId: string,
  suffix: string,
  options?: FetchAgentSessionOptions
) {
  const query = new URLSearchParams();

  if (options?.chatMessageTail) {
    query.set("chatMessageTail", String(options.chatMessageTail));
  }

  if (options?.fullTranscript) {
    query.set("fullTranscript", "1");
  }

  if (options?.includeSessionSummary) {
    query.set("includeSessionSummary", "1");
  }

  if (options?.omitTranscript) {
    query.set("omitTranscript", "1");
  }

  if (options?.transcriptTail) {
    query.set("transcriptTail", String(options.transcriptTail));
  }

  if (options?.transcriptDetail === "summary") {
    query.set("transcriptDetail", "summary");
  }

  if (options?.waitingSince) {
    query.set("waitingSince", options.waitingSince);
  }

  if (options?.baseItemKey) {
    query.set("baseItemKey", options.baseItemKey);
  }

  if (options?.baseSourceEntryId) {
    query.set("baseSourceEntryId", options.baseSourceEntryId);
  }

  if (options?.overlapItemCount !== undefined) {
    query.set("overlapItemCount", String(options.overlapItemCount));
  }

  return `/api/agents/sessions/${encodeURIComponent(agentSessionId)}${suffix}${
    query.size ? `?${query.toString()}` : ""
  }`;
}

function buildAgentSessionUrl(agentSessionId: string, options?: FetchAgentSessionOptions) {
  return buildAgentSessionRequestUrl(agentSessionId, "", options);
}

function buildAgentSessionTranscriptViewUrl(agentSessionId: string, options?: FetchAgentSessionOptions) {
  return buildAgentSessionRequestUrl(agentSessionId, "/transcript-view", options);
}

function buildAgentSessionTranscriptUpdatesUrl(agentSessionId: string, options?: FetchAgentSessionOptions) {
  return buildAgentSessionRequestUrl(agentSessionId, "/transcript-updates", options);
}

export const agentSessionsApi = {
  getList(options: FetchAgentSessionsOptions = {}) {
    const query = new URLSearchParams();

    if (options.limit) {
      query.set("limit", String(options.limit));
    }

    if (options.offset) {
      query.set("offset", String(options.offset));
    }

    if (options.query?.trim()) {
      query.set("query", options.query.trim());
    }

    if (options.sourceId && options.sourceId !== "all") {
      query.set("source", options.sourceId);
    }

    if (options.includeLiveMetadata) {
      query.set("includeLiveMetadata", "1");
    }

    if (options.includeSubagents) {
      query.set("includeSubagents", "1");
    }

    if (options.parentSessionId?.trim()) {
      query.set("parentSessionId", options.parentSessionId.trim());
    }

    return getJson<AgentSessionsResponse>(
      `/api/agents/sessions${query.size ? `?${query.toString()}` : ""}`,
      "Failed to load agent chats",
      {
        signal: options.signal
      }
    );
  },

  getOne(agentSessionId: string, options?: FetchAgentSessionOptions) {
    return getNullableJson<AgentSessionDetail>(
      buildAgentSessionUrl(agentSessionId, options),
      "Failed to load agent chat",
      {
        signal: options?.signal
      }
    );
  },

  getTranscriptView(agentSessionId: string, options?: FetchAgentSessionOptions) {
    return getConditionalJson<AgentSessionTranscriptViewResponse>(
      buildAgentSessionTranscriptViewUrl(agentSessionId, options),
      "Failed to load agent chat transcript",
      {
        signal: options?.signal
      }
    );
  },

  getTranscriptViewWithMeta(agentSessionId: string, options?: FetchAgentSessionOptions) {
    return getConditionalJsonResult<AgentSessionTranscriptViewResponse>(
      buildAgentSessionTranscriptViewUrl(agentSessionId, options),
      "Failed to load agent chat transcript",
      {
        signal: options?.signal
      }
    );
  },

  getTranscriptUpdatesWithMeta(agentSessionId: string, options?: FetchAgentSessionOptions) {
    return getConditionalJsonResult<AgentSessionTranscriptUpdatesResponse>(
      buildAgentSessionTranscriptUpdatesUrl(agentSessionId, options),
      "Failed to load agent chat transcript updates",
      {
        signal: options?.signal
      }
    );
  },

  getChanges(
    agentSessionId: string,
    groupId: string,
    options: FetchAgentSessionChangesOptions = {}
  ) {
    const scopedUrl = buildAgentSessionScopedUrl(
      agentSessionId,
      `/changes/${encodeURIComponent(groupId)}`
    );
    const query = new URLSearchParams();
    const sourceEntryIds = options.sourceEntryIds
      ?.map((entryId) => entryId.trim())
      .filter(Boolean);
    if (sourceEntryIds?.length) {
      query.set("entryIds", Array.from(new Set(sourceEntryIds)).join(","));
    }

    if (options.sourceEntryRanges?.length) {
      query.set("entryRanges", JSON.stringify(options.sourceEntryRanges));
    }

    if (options.sourceEntrySpans?.length) {
      query.set("entrySpans", JSON.stringify(options.sourceEntrySpans));
    }

    if (shouldPostHydrationRequest(query)) {
      return postJson<AgentSessionChangesResponse>(
        scopedUrl,
        {
          entryIds: sourceEntryIds,
          entryRanges: options.sourceEntryRanges,
          entrySpans: options.sourceEntrySpans
        },
        "Failed to load changed files",
        {
          signal: options.signal
        }
      );
    }

    return getConditionalJson<AgentSessionChangesResponse>(
      `${scopedUrl}${query.size ? `?${query.toString()}` : ""}`,
      "Failed to load changed files",
      {
        signal: options.signal
      }
    );
  },

  async getChangesWithMeta(
    agentSessionId: string,
    groupId: string,
    options: FetchAgentSessionChangesOptions = {}
  ): Promise<ConditionalJsonResult<AgentSessionChangesResponse>> {
    const scopedUrl = buildAgentSessionScopedUrl(
      agentSessionId,
      `/changes/${encodeURIComponent(groupId)}`
    );
    const query = new URLSearchParams();
    const sourceEntryIds = options.sourceEntryIds
      ?.map((entryId) => entryId.trim())
      .filter(Boolean);
    if (sourceEntryIds?.length) {
      query.set("entryIds", Array.from(new Set(sourceEntryIds)).join(","));
    }

    if (options.sourceEntryRanges?.length) {
      query.set("entryRanges", JSON.stringify(options.sourceEntryRanges));
    }

    if (options.sourceEntrySpans?.length) {
      query.set("entrySpans", JSON.stringify(options.sourceEntrySpans));
    }

    if (shouldPostHydrationRequest(query)) {
      return postConditionalJsonResult<AgentSessionChangesResponse>(
        scopedUrl,
        {
          entryIds: sourceEntryIds,
          entryRanges: options.sourceEntryRanges,
          entrySpans: options.sourceEntrySpans
        },
        "Failed to load changed files",
        {
          signal: options.signal
        }
      );
    }

    return getConditionalJsonResult<AgentSessionChangesResponse>(
      `${scopedUrl}${query.size ? `?${query.toString()}` : ""}`,
      "Failed to load changed files",
      {
        signal: options.signal
      }
    );
  },

  async getTranscriptEntries(
    agentSessionId: string,
    entryIds: string[],
    options?: { signal?: AbortSignal }
  ) {
    const response = await agentSessionsApi.getTranscriptEntriesWithMeta(
      agentSessionId,
      entryIds,
      options
    );

    return response.data.entries;
  },

  async getTranscriptEntriesWithMeta(
    agentSessionId: string,
    entryIds: string[],
    options?: { signal?: AbortSignal }
  ): Promise<ConditionalJsonResult<AgentSessionTranscriptEntriesResponse>> {
    const uniqueEntryIds = Array.from(new Set(
      entryIds.map((entryId) => entryId.trim()).filter(Boolean)
    ));

    if (uniqueEntryIds.length === 0) {
      return buildUncachedConditionalJsonResult({
        entries: []
      });
    }

    const query = new URLSearchParams({
      entryIds: uniqueEntryIds.join(",")
    });
    const scopedUrl = buildAgentSessionScopedUrl(agentSessionId, "/transcript-entries");

    if (shouldPostHydrationRequest(query)) {
      return postConditionalJsonResult<AgentSessionTranscriptEntriesResponse>(
        scopedUrl,
        {
          entryIds: uniqueEntryIds
        },
        "Failed to load chat details",
        {
          signal: options?.signal
        }
      );
    }

    return getConditionalJsonResult<AgentSessionTranscriptEntriesResponse>(
      `${scopedUrl}?${query.toString()}`,
      "Failed to load chat details",
      {
        signal: options?.signal
      }
    );
  },

  getTranscriptPage(
    agentSessionId: string,
    options: FetchAgentSessionTranscriptPageOptions
  ) {
    const query = new URLSearchParams({
      beforeEntryId: options.beforeEntryId
    });

    if (options.limit) {
      query.set("limit", String(options.limit));
    }

    return getConditionalJson<AgentSessionTranscriptPageResponse>(
      `${buildAgentSessionScopedUrl(agentSessionId, "/transcript-page")}?${query.toString()}`,
      "Failed to load earlier chat messages",
      {
        signal: options.signal
      }
    );
  },

  attach(agentSessionId: string, prompt?: string, commandId?: string) {
    return postApi<SessionDetail | SessionCommandAccepted | ApiErrorPayload>(
      buildAgentSessionScopedUrl(agentSessionId, "/attach"),
      {
        prompt: prompt?.trim() || undefined
      },
      {
        commandId,
        timeoutMs: 60_000
      }
    );
  },

  async markReviewed(agentSessionId: string) {
    const result = await postApi<{ agentSessionId: string; reviewedAt: string }>(
      buildAgentSessionScopedUrl(agentSessionId, "/reviewed"),
      {}
    );

    if (!result.ok) {
      throw new Error(result.data.error ?? "Failed to mark agent chat as reviewed");
    }

    return result.data;
  }
};
