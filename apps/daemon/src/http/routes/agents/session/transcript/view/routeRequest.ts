import type express from "express";

import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

import { readPositiveIntegerQuery } from "../../../../../middleware/query.ts";
import type { JsonResponseOptions } from "../../jsonResponse.ts";
import {
  MAX_AGENT_SESSION_TRANSCRIPT_TAIL,
  readBooleanQuery,
  readNonNegativeIntegerQuery,
  readOptionalStringQuery,
  readTranscriptDetailQuery
} from "../routeHelpers.ts";
import {
  DEFAULT_AGENT_SESSION_CHAT_MESSAGE_TAIL,
  DEFAULT_TRANSCRIPT_DELTA_OVERLAP_ITEM_COUNT,
  MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL,
  MAX_TRANSCRIPT_DELTA_OVERLAP_ITEM_COUNT
} from "./projection.ts";
import type { TranscriptViewEtagOptions } from "./projection.ts";

export type TranscriptViewRouteDependencies = {
  jsonResponseOptions: JsonResponseOptions;
  sourceAgentSessions: SourceAgentSessionService;
};

export type TranscriptViewRouteRequest = TranscriptViewEtagOptions & {
  transcriptViewOptions: TranscriptViewEtagOptions;
};

export function readTranscriptViewRouteRequest(
  query: express.Request["query"]
): TranscriptViewRouteRequest {
  const requestedTranscriptTail = readPositiveIntegerQuery(query.transcriptTail);
  const requestedChatMessageTail = readPositiveIntegerQuery(query.chatMessageTail);
  const requestedFullTranscript = readBooleanQuery(query.fullTranscript);
  const transcriptTail = requestedTranscriptTail === null
    ? null
    : Math.min(requestedTranscriptTail, MAX_AGENT_SESSION_TRANSCRIPT_TAIL);
  // `fullTranscript=1` is retained as a compatibility hint, but it no longer
  // permits an unbounded full-file hydration. A chat-message boundary keeps a
  // dense turn intact; a raw-entry cap can begin midway through the turn and
  // separate its Details, Tools and Changes from the terminal assistant reply.
  const fullTranscript = false;
  const transcriptDetail = readTranscriptDetailQuery(query.transcriptDetail);
  const includeSessionSummary = readBooleanQuery(query.includeSessionSummary);
  const waitingSince = readOptionalStringQuery(query.waitingSince);
  const chatMessageTail =
    requestedChatMessageTail === null &&
    transcriptTail === null
      ? requestedFullTranscript
        ? MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL
        : DEFAULT_AGENT_SESSION_CHAT_MESSAGE_TAIL
      : requestedChatMessageTail === null
        ? null
        : Math.min(
            requestedChatMessageTail,
            MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL
          );
  const transcriptViewOptions = {
    chatMessageTail,
    fullTranscript,
    includeSessionSummary,
    transcriptDetail,
    transcriptTail,
    waitingSince
  } satisfies TranscriptViewEtagOptions;

  return {
    chatMessageTail,
    fullTranscript,
    includeSessionSummary,
    transcriptDetail,
    transcriptTail,
    transcriptViewOptions,
    waitingSince
  };
}

export function readTranscriptDeltaRouteRequest(query: express.Request["query"]) {
  const viewRequest = readTranscriptViewRouteRequest(query);
  const baseItemKey = readOptionalStringQuery(query.baseItemKey);
  const baseSourceEntryId = readOptionalStringQuery(query.baseSourceEntryId);
  const requestedOverlapItemCount = readNonNegativeIntegerQuery(
    query.overlapItemCount
  );
  const overlapItemCount = Math.min(
    requestedOverlapItemCount ?? DEFAULT_TRANSCRIPT_DELTA_OVERLAP_ITEM_COUNT,
    MAX_TRANSCRIPT_DELTA_OVERLAP_ITEM_COUNT
  );

  return {
    ...viewRequest,
    baseItemKey,
    baseSourceEntryId,
    overlapItemCount
  };
}
