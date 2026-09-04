import type express from "express";

import type { AgentKind } from "@deskcue/protocol";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

import { MAX_AGENT_SESSION_TRANSCRIPT_TAIL } from "./transcript/routeHelpers.ts";
import { readPositiveIntegerQuery } from "../../../middleware/query.ts";
import { setRequestMetrics } from "../../../middleware/requestLogger.ts";
import { trimAgentSessionTranscript } from "../../../transcript/agentTranscript.ts";
import { summarizeAgentSessionTranscript } from "../../../transcript/agentTranscriptSummary.ts";

const DEFAULT_AGENT_SESSIONS_LIMIT = 100;
const MAX_AGENT_SESSIONS_LIMIT = 100;
const DEFAULT_AGENT_SESSION_CHAT_MESSAGE_TAIL = 24;
const MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL = 200;

type InstallAgentSessionReadRoutesOptions = {
  sourceAgentSessions: SourceAgentSessionService;
};

function readOptionalStringQuery(value: unknown) {
  const rawValue: unknown = Array.isArray(value) ? value[0] : value;

  return typeof rawValue === "string" ? rawValue.trim() || null : null;
}

function readTranscriptDetailQuery(value: unknown) {
  const rawValue = readOptionalStringQuery(value);

  return rawValue === "summary" ? "summary" : "full";
}

function readBooleanQuery(value: unknown) {
  const rawValue: unknown = Array.isArray(value) ? value[0] : value;

  return rawValue === "1" || rawValue === "true";
}

function readAgentKindQuery(value: unknown): AgentKind | null {
  const rawValue = readOptionalStringQuery(value);

  if (
    rawValue === "codex" ||
    rawValue === "claude-code" ||
    rawValue === "other"
  ) {
    return rawValue;
  }

  return null;
}

function readNonNegativeIntegerQuery(value: unknown) {
  const rawValue: unknown = Array.isArray(value) ? value[0] : value;

  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return null;
  }

  const parsed = Number(rawValue);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function installAgentSessionReadRoutes(
  app: express.Express,
  { sourceAgentSessions }: InstallAgentSessionReadRoutesOptions
) {
  app.get("/api/agents/sessions", async (request, response, next) => {
    try {
      const limit = Math.min(
        readPositiveIntegerQuery(request.query.limit) ?? DEFAULT_AGENT_SESSIONS_LIMIT,
        MAX_AGENT_SESSIONS_LIMIT
      );
      const offset = readNonNegativeIntegerQuery(request.query.offset) ?? 0;
      const query = readOptionalStringQuery(request.query.query);
      const sourceId = readAgentKindQuery(request.query.source);
      const parentSessionId = readOptionalStringQuery(request.query.parentSessionId);
      const includeSubagents = readBooleanQuery(request.query.includeSubagents);
      const includeLiveMetadata = readBooleanQuery(request.query.includeLiveMetadata);
      const sessionPage = await sourceAgentSessions.listRecentSessionPage(limit, includeLiveMetadata, {
        includeSubagents,
        offset,
        parentSessionId,
        query,
        sourceId
      });

      setRequestMetrics(response, {
        endpoint: "agent.sessions-list",
        hasMore: sessionPage.hasMore,
        hierarchy: parentSessionId ? "children" : includeSubagents ? "all" : "roots",
        includeLiveMetadata,
        indexSnapshotAgeMs: sessionPage.indexSnapshot?.ageMs ?? null,
        indexSnapshotReadMode: sessionPage.indexSnapshot?.readMode ?? null,
        indexSnapshotRefreshing: sessionPage.indexSnapshot?.refreshing ?? null,
        indexSnapshotSessionCount: sessionPage.indexSnapshot?.sessionCount ?? null,
        indexSnapshotStorage: sessionPage.indexSnapshot?.storage ?? null,
        limit,
        offset,
        readMode: sessionPage.indexSnapshot
          ? `discovery-page+${sessionPage.indexSnapshot.readMode}`
          : "discovery-page",
        returnedSessionCount: sessionPage.sessions.length,
        sourceCountCount: sessionPage.sourceCounts.length,
        totalCount: sessionPage.totalCount,
        totalCountExact: sessionPage.totalCountExact
      });
      response.json({
        ...sessionPage,
        sessions: sessionPage.sessions.map((session) =>
          sourceAgentSessions.reconcileAttachedSession(session)
        )
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/agents/sessions/:agentSessionId", async (request, response, next) => {
    try {
      const requestedTranscriptTail = readPositiveIntegerQuery(request.query.transcriptTail);
      const requestedChatMessageTail = readPositiveIntegerQuery(request.query.chatMessageTail);
      const requestedFullTranscript = readBooleanQuery(request.query.fullTranscript);
      const transcriptTail = requestedTranscriptTail === null
        ? requestedFullTranscript
          ? MAX_AGENT_SESSION_TRANSCRIPT_TAIL
          : null
        : Math.min(requestedTranscriptTail, MAX_AGENT_SESSION_TRANSCRIPT_TAIL);
      const omitTranscript = readBooleanQuery(request.query.omitTranscript);
      const transcriptDetail = readTranscriptDetailQuery(request.query.transcriptDetail);
      const chatMessageTail = requestedChatMessageTail === null && transcriptTail === null
        ? DEFAULT_AGENT_SESSION_CHAT_MESSAGE_TAIL
        : requestedChatMessageTail === null
          ? null
          : Math.min(requestedChatMessageTail, MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL);
      const session = await sourceAgentSessions.getSessionDetail(
        request.params.agentSessionId,
        false,
        transcriptTail ?? undefined,
        chatMessageTail ?? undefined,
        transcriptDetail === "summary"
          ? {
              lightweight: "bounded-exact-ids"
            }
          : undefined
      );

      if (!session) {
        response.status(404).json({
          error: "Agent session not found."
        });
        return;
      }

      sourceAgentSessions.syncReplyStateFromAgentSession(session);
      const responseSession = trimAgentSessionTranscript(
        sourceAgentSessions.reconcileAttachedSession(session),
        transcriptTail
      );
      const visibleSession = transcriptDetail === "summary"
        ? summarizeAgentSessionTranscript(responseSession)
        : responseSession;
      response.json(omitTranscript ? { ...visibleSession, transcript: [] } : visibleSession);
    } catch (error) {
      next(error);
    }
  });
}
