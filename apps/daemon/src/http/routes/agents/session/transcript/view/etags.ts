import { createHash } from "node:crypto";

import type { AgentSessionDetail, AgentSessionSourceVersion } from "@deskcue/protocol";

import { toAgentSessionSummary } from "./sessionProjection.ts";

export type TranscriptViewEtagOptions = {
  chatMessageTail: number | null;
  fullTranscript: boolean;
  includeSessionSummary: boolean;
  transcriptDetail: "full" | "summary";
  transcriptTail: number | null;
  waitingSince: string | null;
};

function weakEtag(source: object) {
  return `W/"${createHash("sha1")
    .update(JSON.stringify(source))
    .digest("base64url")}"`;
}

export function buildTranscriptViewEtag(
  session: AgentSessionDetail,
  options: TranscriptViewEtagOptions
) {
  const latestEntry = session.transcript.at(-1);
  return weakEtag({
    agentSessionId: session.id,
    chatMessageTail: options.chatMessageTail,
    fullTranscript: options.fullTranscript,
    includeSessionSummary: options.includeSessionSummary,
    latestEntryId: latestEntry?.id ?? null,
    latestEntryTimestamp: latestEntry?.timestamp ?? null,
    reviewedAt: session.reviewedAt ?? null,
    sessionSummary: options.includeSessionSummary ? toAgentSessionSummary(session) : null,
    transcriptDetail: options.transcriptDetail,
    transcriptLength: session.transcript.length,
    transcriptTail: options.transcriptTail,
    updatedAt: session.updatedAt,
    waitingSince: options.waitingSince
  });
}

export function buildTranscriptViewDeltaEtag(
  session: AgentSessionDetail,
  options: TranscriptViewEtagOptions,
  deltaOptions: {
    baseItemKey: string | null;
    overlapItemCount: number;
  }
) {
  return weakEtag({
    base: buildTranscriptViewEtag(session, options),
    baseItemKey: deltaOptions.baseItemKey,
    overlapItemCount: deltaOptions.overlapItemCount
  });
}

export function buildTranscriptViewSourceVersionEtag(
  version: AgentSessionSourceVersion,
  options: TranscriptViewEtagOptions
) {
  return weakEtag({
    agentSessionId: version.summary.id,
    chatMessageTail: options.chatMessageTail,
    fullTranscript: options.fullTranscript,
    includeSessionSummary: options.includeSessionSummary,
    localStateVersion: options.includeSessionSummary ? version.localStateVersion ?? null : null,
    sessionSummary: options.includeSessionSummary ? version.summary : null,
    sourceVersion: version.sourceVersion,
    transcriptDetail: options.transcriptDetail,
    transcriptTail: options.transcriptTail,
    waitingSince: options.waitingSince
  });
}

export function buildTranscriptViewDeltaSourceVersionEtag(
  version: AgentSessionSourceVersion,
  options: TranscriptViewEtagOptions,
  deltaOptions: {
    baseItemKey: string | null;
    overlapItemCount: number;
  }
) {
  return weakEtag({
    base: buildTranscriptViewSourceVersionEtag(version, options),
    baseItemKey: deltaOptions.baseItemKey,
    overlapItemCount: deltaOptions.overlapItemCount
  });
}
