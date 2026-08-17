import type {
  AgentTranscriptChangesResponse,
  AgentTranscriptEntriesResponse,
  AgentTranscriptPageResponse,
  AgentTranscriptViewDeltaResponse,
  AgentTranscriptViewResponse,
  AgentKind,
  AgentTranscriptSourceRange
} from "@deskcue/protocol";

export type FetchAgentSessionsOptions = {
  includeLiveMetadata?: boolean;
  limit?: number;
  offset?: number;
  query?: string;
  signal?: AbortSignal;
  sourceId?: AgentKind | "all";
};

export type FetchAgentSessionOptions = {
  baseItemKey?: string | null;
  baseSourceEntryId?: string | null;
  chatMessageTail?: number;
  fullTranscript?: boolean;
  includeSessionSummary?: boolean;
  includeTranscriptView?: boolean;
  omitTranscript?: boolean;
  overlapItemCount?: number;
  signal?: AbortSignal;
  transcriptDetail?: "full" | "summary";
  transcriptTail?: number;
  waitingSince?: string | null;
};

export type FetchAgentSessionTranscriptPageOptions = {
  beforeEntryId: string;
  limit?: number;
  signal?: AbortSignal;
};

export type FetchAgentSessionChangesOptions = {
  signal?: AbortSignal;
  sourceEntryIds?: string[];
  sourceEntryRanges?: AgentTranscriptSourceRange[];
  sourceEntrySpans?: AgentTranscriptSourceRange[];
};

export type AgentSessionTranscriptPageResponse = AgentTranscriptPageResponse;

export type AgentSessionTranscriptEntriesResponse = AgentTranscriptEntriesResponse;

export type AgentSessionTranscriptUpdatesResponse = AgentTranscriptViewDeltaResponse;

export type AgentSessionTranscriptViewResponse = AgentTranscriptViewResponse;

export type AgentSessionChangesResponse = AgentTranscriptChangesResponse;
