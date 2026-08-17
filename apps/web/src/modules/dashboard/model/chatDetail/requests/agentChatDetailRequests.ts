import type {
  AgentSessionDetail,
  AgentTranscriptActivityGroup,
  AgentTranscriptEntry,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";
import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import type {
  AgentSessionTranscriptUpdatesResponse,
  FetchAgentSessionOptions as AgentSessionRequestOptions
} from "@api/endpoint/agentSessions/types";
import { boundLiveTranscriptView } from "@models/bounds/agentTranscriptBounds";
import type { SessionTab } from "@models/sessionTabs";
import {
  AGENT_SESSION_DETAIL_CHAT_MESSAGE_TAIL,
  AGENT_SESSION_LIVE_SUMMARY_CHAT_MESSAGE_TAIL
} from "@modules/dashboard/model/data/dashboardConstants";

export type AgentChatTranscriptDetail = "full" | "summary";

export type FetchAgentSessionOptions = AgentSessionRequestOptions & {
  bypassDedupe?: boolean;
  minimumUpdatedAt?: string | null;
};

export type AgentChatDetailFetchResult = {
  detail: AgentSessionDetail | null;
  etag: string | null;
  notModified: boolean;
  status: number;
};

type BuildAgentChatDetailFetchOptionsArgs = {
  activeTab: SessionTab;
  fullTranscript?: boolean;
  minimumUpdatedAt?: string | null;
  signal?: AbortSignal;
  transcriptDetail: AgentChatTranscriptDetail;
};

type FetchAgentChatDetailArgs = BuildAgentChatDetailFetchOptionsArgs & {
  baseDetail?: AgentSessionDetail | null;
  bypassDedupe?: boolean;
};

const TRANSCRIPT_UPDATES_OVERLAP_ITEM_COUNT = 4;

export function resolveAgentChatTranscriptDetail(
  activeTab: SessionTab,
  options: { summaryOnOverview: boolean }
): AgentChatTranscriptDetail {
  return activeTab === "overview" && options.summaryOnOverview ? "summary" : "full";
}

export function shouldIncludeAgentChatTranscriptView(
  activeTab: SessionTab,
  transcriptDetail: AgentChatTranscriptDetail
) {
  return (
    transcriptDetail === "summary" &&
    (activeTab === "overview" || activeTab === "activity" || activeTab === "diff")
  );
}

export function buildAgentChatDetailFetchOptions({
  activeTab,
  fullTranscript,
  minimumUpdatedAt,
  signal,
  transcriptDetail
}: BuildAgentChatDetailFetchOptionsArgs): FetchAgentSessionOptions {
  const includeTranscriptView = shouldIncludeAgentChatTranscriptView(activeTab, transcriptDetail);
  return {
    chatMessageTail:
      transcriptDetail === "summary"
        ? AGENT_SESSION_LIVE_SUMMARY_CHAT_MESSAGE_TAIL
        : AGENT_SESSION_DETAIL_CHAT_MESSAGE_TAIL,
    includeTranscriptView,
    minimumUpdatedAt,
    signal,
    transcriptDetail,
    ...(fullTranscript ? { fullTranscript: true } : {}),
    ...(transcriptDetail === "summary" && !includeTranscriptView
      ? { omitTranscript: true }
      : {})
  };
}

function buildTranscriptEntriesFromView(
  transcriptView: NonNullable<AgentSessionDetail["transcriptView"]>
) {
  const entriesById = new Map<string, AgentSessionDetail["transcript"][number]>();

  for (const item of transcriptView.items) {
    if (item.type === "message") {
      entriesById.set(item.entry.id, item.entry);
      continue;
    }

    for (const entry of item.activity.entries) {
      entriesById.set(entry.id, entry);
    }
  }

  if (transcriptView.latestWaitingDetailEntry) {
    entriesById.set(transcriptView.latestWaitingDetailEntry.id, transcriptView.latestWaitingDetailEntry);
  }

  return Array.from(entriesById.values()).sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp)
  );
}

function mergeTranscriptViewDelta(
  baseTranscriptView: AgentTranscriptViewResponse,
  delta: AgentSessionTranscriptUpdatesResponse
): AgentTranscriptViewResponse {
  if (!delta.replaceFromItemKey || baseTranscriptView.sessionId !== delta.sessionId) {
    return delta;
  }

  const replaceIndex = baseTranscriptView.items.findIndex(
    (item) => item.key === delta.replaceFromItemKey
  );
  const prefixItems = replaceIndex >= 0
    ? baseTranscriptView.items.slice(0, replaceIndex)
    : baseTranscriptView.items;

  return boundLiveTranscriptView({
    ...delta,
    session: delta.session ?? baseTranscriptView.session,
    items: [...prefixItems, ...delta.items]
  })!;
}

function readTranscriptEntryLineRef(entryId: string) {
  const separatorIndex = entryId.lastIndexOf("-");
  if (separatorIndex < 0 || separatorIndex === entryId.length - 1) {
    return null;
  }

  const lineIndex = Number(entryId.slice(separatorIndex + 1));
  return Number.isInteger(lineIndex) && lineIndex >= 0
    ? {
        lineIndex,
        prefix: entryId.slice(0, separatorIndex + 1)
      }
    : null;
}

function readLatestTranscriptViewItemSourceEntryId(
  item: AgentTranscriptViewResponse["items"][number]
) {
  const candidates: Array<{ entryId: string; lineIndex: number; prefix: string }> = [];
  const rememberEntryId = (entryId: string | null | undefined) => {
    const normalizedEntryId = entryId ?? null;
    const parsed = normalizedEntryId ? readTranscriptEntryLineRef(normalizedEntryId) : null;
    if (parsed && normalizedEntryId) {
      candidates.push({
        entryId: normalizedEntryId,
        ...parsed
      });
    }
  };
  const rememberSourceRefs = (
    sourceRefs: Pick<
      AgentTranscriptActivityGroup | AgentTranscriptEntry,
      "sourceEntryIds" | "sourceEntryRanges" | "sourceEntrySpans"
    >
  ) => {
    for (const entryId of sourceRefs.sourceEntryIds ?? []) {
      rememberEntryId(entryId);
    }
    for (const range of [
      ...(sourceRefs.sourceEntryRanges ?? []),
      ...(sourceRefs.sourceEntrySpans ?? [])
    ]) {
      rememberEntryId(`${range.prefix}${range.end}`);
    }
  };
  const rememberActivity = (
    activity: AgentTranscriptActivityGroup
  ) => {
    rememberSourceRefs(activity);
    for (const entryId of activity.entryIds) {
      rememberEntryId(entryId);
    }
  };

  if (item.type === "message") {
    rememberEntryId(item.entry.id);
    rememberSourceRefs(item.entry);
    for (const activity of [...item.activities, ...item.changeActivities]) {
      rememberActivity(activity);
    }
  } else {
    rememberActivity(item.activity);
  }

  const latest = candidates.sort((left, right) => {
    const lineDelta = right.lineIndex - left.lineIndex;
    return lineDelta === 0 ? left.prefix.localeCompare(right.prefix) : lineDelta;
  })[0];
  return latest?.entryId ?? null;
}

function shouldReadTranscriptUpdates(
  options: FetchAgentSessionOptions
) {
  return (
    Boolean(options.minimumUpdatedAt) &&
    options.transcriptDetail === "summary" &&
    options.fullTranscript !== true &&
    !options.transcriptTail &&
    !options.includeSessionSummary
  );
}

async function readTranscriptViewWithOptionalDelta(
  agentSessionId: string,
  options: FetchAgentSessionOptions,
  baseDetail: AgentSessionDetail | null
) {
  const baseTranscriptView = baseDetail?.transcriptView;
  const baseItemKey = baseTranscriptView?.items.at(-1)?.key ?? null;
  const baseSourceEntryId = baseTranscriptView?.items.at(-1)
    ? readLatestTranscriptViewItemSourceEntryId(baseTranscriptView.items.at(-1)!)
    : null;
  if (baseTranscriptView && baseItemKey && shouldReadTranscriptUpdates(options)) {
    const transcriptUpdatesResult = await agentSessionsApi.getTranscriptUpdatesWithMeta(
      agentSessionId,
      {
        ...options,
        baseItemKey,
        baseSourceEntryId,
        overlapItemCount: TRANSCRIPT_UPDATES_OVERLAP_ITEM_COUNT
      }
    );

    return {
      ...transcriptUpdatesResult,
      data: transcriptUpdatesResult.notModified
        ? baseTranscriptView
        : mergeTranscriptViewDelta(baseTranscriptView, transcriptUpdatesResult.data)
    };
  }

  return agentSessionsApi.getTranscriptViewWithMeta(agentSessionId, options);
}

export async function readAgentChatDetail(
  agentSessionId: string,
  args: FetchAgentChatDetailArgs
): Promise<AgentChatDetailFetchResult> {
  const options = buildAgentChatDetailFetchOptions(args);
  const shouldLoadTranscriptView = options.includeTranscriptView === true;
  const baseDetail = args.baseDetail?.id === agentSessionId ? args.baseDetail : null;

  if (shouldLoadTranscriptView) {
    const transcriptViewResult = await readTranscriptViewWithOptionalDelta(
      agentSessionId,
      {
        ...options,
        includeSessionSummary: !baseDetail
      },
      baseDetail
    );
    const transcriptView = transcriptViewResult.data;

    if (transcriptView.session) {
      return {
        detail: {
          ...transcriptView.session,
          transcript: buildTranscriptEntriesFromView(transcriptView),
          transcriptView
        },
        etag: transcriptViewResult.etag,
        notModified: transcriptViewResult.notModified,
        status: transcriptViewResult.status
      };
    }

    if (baseDetail) {
      return {
        detail: {
          ...baseDetail,
          transcript: buildTranscriptEntriesFromView(transcriptView),
          transcriptView,
          updatedAt: transcriptView.updatedAt
        },
        etag: transcriptViewResult.etag,
        notModified: transcriptViewResult.notModified,
        status: transcriptViewResult.status
      };
    }
  }

  const shouldOmitTranscript = shouldLoadTranscriptView || options.omitTranscript === true;
  const session = await agentSessionsApi.getOne(agentSessionId, {
    ...options,
    omitTranscript: shouldOmitTranscript
  });

  if (!session || !shouldLoadTranscriptView) {
    return {
      detail: session,
      etag: null,
      notModified: false,
      status: session ? 200 : 404
    };
  }

  const transcriptViewResult = await agentSessionsApi.getTranscriptViewWithMeta(
    agentSessionId,
    options
  );
  const transcriptView = transcriptViewResult.data;

  return {
    detail: {
      ...session,
      transcript: session.transcript.length > 0
        ? session.transcript
        : buildTranscriptEntriesFromView(transcriptView),
      transcriptView
    },
    etag: transcriptViewResult.etag,
    notModified: transcriptViewResult.notModified,
    status: transcriptViewResult.status
  };
}

export function fetchAgentChatDetail(
  agentSessionId: string,
  args: FetchAgentChatDetailArgs
): Promise<AgentSessionDetail | null> {
  return readAgentChatDetail(agentSessionId, args)
    .then((result) => result.detail);
}
