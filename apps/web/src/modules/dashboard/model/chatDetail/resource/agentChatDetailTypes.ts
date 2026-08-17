import type {
  AgentSessionDetail,
  AgentTranscriptChangesResponse,
  AgentTranscriptEntry,
  AgentTranscriptSourceRefs
} from "@deskcue/protocol";
import type { ConditionalJsonResult } from "@api/transport/requests";
import type { SessionTab } from "@models/sessionTabs";
import type {
  AgentChatDetailFetchResult,
  AgentChatTranscriptDetail
} from "@modules/dashboard/model/chatDetail/requests/agentChatDetailRequests";

export type AgentChatDetailLoadReason =
  | "initial"
  | "manual"
  | "live-event"
  | "reconnect"
  | "focus"
  | "visibility"
  | "mobile-resume"
  | "prompt-watchdog"
  | "retry";

export type AgentChatDetailResourceStatus =
  | "idle"
  | "loading"
  | "refreshing"
  | "synced"
  | "stale"
  | "error";

export type AgentChatDetailLoadOptions = {
  activeTab: SessionTab;
  bypassDedupe?: boolean;
  force?: boolean;
  fullTranscript?: boolean;
  minNetworkIntervalMs?: number;
  minimumUpdatedAt?: string | null;
  reason?: AgentChatDetailLoadReason;
  retry?: boolean;
  signal?: AbortSignal;
  transcriptDetail: AgentChatTranscriptDetail;
};

export type AgentChatDetailResourceSnapshot = {
  detail: AgentSessionDetail | null;
  error: Error | null;
  etag: string | null;
  isStale: boolean;
  lastLoadedAt: number | null;
  lastValidatedAt: number | null;
  retryAfterAt: number | null;
  retryAttempt: number;
  sessionId: string;
  sourceVersion: string | null;
  staleReason: AgentChatDetailLoadReason | null;
  status: AgentChatDetailResourceStatus;
  updatedAt: string | null;
};

export type AgentChatDetailResourceTransport = {
  fetchDetail: (
    agentSessionId: string,
    options: AgentChatDetailLoadOptions
  ) => Promise<AgentChatDetailFetchResult>;
  hydrateChanges: (
    agentSessionId: string,
    groupId: string,
    sourceRefs: AgentTranscriptSourceRefs | undefined,
    options?: { signal?: AbortSignal }
  ) => Promise<ConditionalJsonResult<AgentTranscriptChangesResponse>>;
  hydrateTranscriptEntries: (
    agentSessionId: string,
    entryIds: string[],
    options?: { signal?: AbortSignal }
  ) => Promise<ConditionalJsonResult<{ entries: AgentTranscriptEntry[] }>>;
};

export type MutableAgentChatDetailState = AgentChatDetailResourceSnapshot & {
  abortController: AbortController | null;
  failedHydrationChangesByKey: Set<string>;
  failedHydrationEntryIds: Set<string>;
  generation: number;
  hydratedChangesByKey: Map<string, AgentTranscriptChangesResponse>;
  hydratedEntriesById: Map<string, AgentTranscriptEntry>;
  idleDisposeTimer: ReturnType<typeof setTimeout> | null;
  missingHydrationEntryIds: Set<string>;
  retryTimer: ReturnType<typeof setTimeout> | null;
};

export type UseAgentChatDetailResourceArgs = {
  activeTab: SessionTab;
  enabled?: boolean;
  minimumUpdatedAt?: string | null;
  onDetail?: (detail: AgentSessionDetail | null, sessionId: string) => void;
  reason?: AgentChatDetailLoadReason;
  refreshKey?: number | string;
  sessionId: string;
  summaryOnOverview?: boolean;
  transcriptDetail?: AgentChatTranscriptDetail;
};

export type AgentChatDetailHookLoadOptions = Partial<
  Pick<
    AgentChatDetailLoadOptions,
    "bypassDedupe" | "force" | "minimumUpdatedAt" | "reason" | "retry"
  >
>;
