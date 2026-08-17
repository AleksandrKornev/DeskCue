import type express from "express";
import { createHash } from "node:crypto";

import type { AgentSessionSourceVersion, AgentTranscriptSourceRange } from "@deskcue/protocol";
import { expandAgentTranscriptSourceRanges } from "@deskcue/protocol";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";
import { logger } from "#infrastructure/logging/logger";

import { requireHeavyAgentRequestBudget } from "../../../../middleware/heavyAgentRequestLimiter.ts";
import { setRequestMetrics } from "../../../../middleware/requestLogger.ts";
import type { AgentTranscriptHttpCache } from "../../../../transcript/agentTranscriptHttpCache.ts";
import type { JsonResponseOptions } from "../jsonResponse.ts";

export const DEFAULT_AGENT_SESSION_TRANSCRIPT_PAGE_LIMIT = 20;
export const MAX_AGENT_SESSION_TRANSCRIPT_PAGE_LIMIT = 50;
export const MAX_AGENT_SESSION_TRANSCRIPT_ENTRY_IDS = 200;
export const MAX_AGENT_SESSION_TRANSCRIPT_RANGE_ENTRY_IDS = 2000;
export const MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL = 200;
export const MAX_AGENT_SESSION_TRANSCRIPT_TAIL = 512;

export type TranscriptRouteDependencies = {
  jsonResponseOptions: JsonResponseOptions;
  sourceAgentSessions: SourceAgentSessionService;
  transcriptHttpCache: AgentTranscriptHttpCache;
};

export function readNonNegativeIntegerQuery(value: unknown) {
  const rawValue: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== "string" || !rawValue.trim()) return null;

  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function readOptionalStringQuery(value: unknown) {
  const rawValue: unknown = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim() || null : null;
}

export function readBooleanQuery(value: unknown) {
  const rawValue: unknown = Array.isArray(value) ? value[0] : value;
  return rawValue === "1" || rawValue === "true";
}

export function readTranscriptDetailQuery(value: unknown) {
  return readOptionalStringQuery(value) === "summary" ? "summary" : "full";
}

export function readRouteParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isTranscriptSourceRange(value: unknown): value is AgentTranscriptSourceRange {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const range = value as AgentTranscriptSourceRange;
  return (
    typeof range.prefix === "string" &&
    range.prefix.length > 0 &&
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.end >= range.start
  );
}

function readTranscriptEntryRangesQuery(value: unknown) {
  if (Array.isArray(value) && value.every(isTranscriptSourceRange)) return value;

  const rawValues = Array.isArray(value) ? value : [value];
  return rawValues.flatMap((rawValue) => {
    if (typeof rawValue !== "string" || !rawValue.trim()) return [];

    try {
      const parsed = JSON.parse(rawValue) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isTranscriptSourceRange) : [];
    } catch {
      return [];
    }
  });
}

function readTranscriptEntryIdsQuery(value: unknown, limit = MAX_AGENT_SESSION_TRANSCRIPT_ENTRY_IDS) {
  const rawValues = Array.isArray(value) ? value : [value];
  const entryIds = rawValues.flatMap((rawValue) =>
    typeof rawValue === "string"
      ? rawValue.split(",").map((entryId) => entryId.trim()).filter(Boolean)
      : []
  );

  return Array.from(new Set(entryIds)).slice(0, limit);
}

function readTranscriptSourceEntryIdsQuery(
  entryIdsValue: unknown,
  entryRangesValue: unknown,
  entrySpansValue: unknown,
  maxEntryIds: number
) {
  return Array.from(new Set([
    ...readTranscriptEntryIdsQuery(entryIdsValue, maxEntryIds),
    ...expandAgentTranscriptSourceRanges(
      readTranscriptEntryRangesQuery(entryRangesValue),
      maxEntryIds
    ),
    ...expandAgentTranscriptSourceRanges(
      readTranscriptEntryRangesQuery(entrySpansValue),
      maxEntryIds
    )
  ])).slice(0, maxEntryIds);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function readTranscriptSourceEntryIdsRequest(
  request: express.Request,
  maxEntryIds: number
) {
  const body = isRecord(request.body) ? request.body : {};

  return readTranscriptSourceEntryIdsQuery(
    body.entryIds ?? request.query.entryIds,
    body.entryRanges ?? request.query.entryRanges,
    body.entrySpans ?? request.query.entrySpans,
    maxEntryIds
  );
}

export function requireHeavyAgentRouteBudget(
  request: express.Request,
  response: express.Response,
  endpoint: string
) {
  const agentSessionId = readRouteParam(request.params.agentSessionId);
  const bucket = agentSessionId ? `${endpoint}\u0000agent-session:${agentSessionId}` : endpoint;
  if (requireHeavyAgentRequestBudget(request, response, bucket)) {
    return true;
  }

  setRequestMetrics(response, {
    agentSessionId,
    endpoint,
    rateLimited: true,
    readMode: "rate-limit"
  });
  return false;
}

export function buildAgentSessionHydrationEtag(
  version: AgentSessionSourceVersion,
  endpoint: string,
  payload: Record<string, unknown>
) {
  const source = JSON.stringify({
    agentSessionId: version.summary.id,
    endpoint,
    localStateVersion: version.localStateVersion ?? null,
    payload,
    sourceVersion: version.sourceVersion
  });

  return `W/"${createHash("sha1").update(source).digest("base64url")}"`;
}

export async function tryReadAgentSessionSourceVersion(
  sourceAgentSessions: SourceAgentSessionService,
  agentSessionId: string
) {
  try {
    return await sourceAgentSessions.getSessionVersion(agentSessionId);
  } catch (error) {
    logger.debug("Agent transcript source version preflight failed", {
      agentSessionId,
      message: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

export function expandTranscriptEntryIdsWithPreviousNeighbors(entryIds: string[]) {
  const expandedEntryIds = new Set<string>();

  for (const entryId of entryIds) {
    expandedEntryIds.add(entryId);

    const separatorIndex = entryId.lastIndexOf("-");
    if (separatorIndex < 0) continue;

    const lineIndex = Number(entryId.slice(separatorIndex + 1));
    if (!Number.isInteger(lineIndex) || lineIndex <= 0) continue;

    expandedEntryIds.add(`${entryId.slice(0, separatorIndex + 1)}${lineIndex - 1}`);
  }

  return Array.from(expandedEntryIds);
}
