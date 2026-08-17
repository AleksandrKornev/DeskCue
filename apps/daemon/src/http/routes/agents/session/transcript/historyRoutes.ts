import type express from "express";

import {
  buildBoundedTranscriptPageFromExactEntries,
  buildTranscriptPage,
  buildTranscriptPageFromPreviousSourceWindow,
  hasPreviousTranscriptSourceWindow
} from "./page.ts";
import {
  buildAgentSessionHydrationEtag,
  DEFAULT_AGENT_SESSION_TRANSCRIPT_PAGE_LIMIT,
  MAX_AGENT_SESSION_TRANSCRIPT_ENTRY_IDS,
  MAX_AGENT_SESSION_TRANSCRIPT_PAGE_LIMIT,
  readOptionalStringQuery,
  readRouteParam,
  readTranscriptSourceEntryIdsRequest,
  requireHeavyAgentRouteBudget,
  tryReadAgentSessionSourceVersion
} from "./routeHelpers.ts";
import type { TranscriptRouteDependencies } from "./routeHelpers.ts";
import { readPositiveIntegerQuery } from "../../../../middleware/query.ts";
import { setRequestMetrics } from "../../../../middleware/requestLogger.ts";
import { sendJsonMaybeWithEtag, sendNotModifiedIfMatched } from "../jsonResponse.ts";

export function installTranscriptHistoryRoutes(
  app: express.Express,
  {
    jsonResponseOptions,
    sourceAgentSessions,
    transcriptHttpCache
  }: TranscriptRouteDependencies
) {
  const handleAgentSessionTranscriptEntriesRequest: express.RequestHandler = async (request, response, next) => {
    try {
      if (!requireHeavyAgentRouteBudget(request, response, "agent.transcript-entries")) return;

      const agentSessionId = readRouteParam(request.params.agentSessionId);
      const entryIds = readTranscriptSourceEntryIdsRequest(
        request,
        MAX_AGENT_SESSION_TRANSCRIPT_ENTRY_IDS
      );
      if (entryIds.length === 0) {
        response.status(400).json({ error: "entryIds is required." });
        return;
      }

      const sourceVersion = await tryReadAgentSessionSourceVersion(sourceAgentSessions, agentSessionId);
      const hydrationEtag = sourceVersion
        ? buildAgentSessionHydrationEtag(sourceVersion, "agent.transcript-entries", {
            entryIds: [...entryIds].sort()
          })
        : null;
      if (sourceVersion && hydrationEtag && sendNotModifiedIfMatched(request, response, hydrationEtag)) {
        setRequestMetrics(response, {
          agentSessionId,
          endpoint: "agent.transcript-entries",
          etagHit: true,
          readMode: "source-version",
          requestedEntryCount: entryIds.length,
          sourceFileSizeBytes: sourceVersion.sourceFileSizeBytes,
          sourceFileMtimeMs: sourceVersion.sourceFileMtimeMs
        });
        return;
      }

      const exactRead = await transcriptHttpCache.readEntries(
        sourceAgentSessions,
        agentSessionId,
        entryIds,
        sourceVersion
      );
      const exactEntries = exactRead.entries;
      if (exactEntries.length > 0) {
        setRequestMetrics(response, {
          agentSessionId,
          cachedMissCount: exactRead.cachedMissCount,
          endpoint: "agent.transcript-entries",
          etagHit: false,
          readMode: "exact-entry",
          readEntryCount: exactRead.readEntryCount,
          requestedEntryCount: entryIds.length,
          returnedEntryCount: exactEntries.length,
          sourceFileSizeBytes: sourceVersion?.sourceFileSizeBytes ?? null,
          sourceFileMtimeMs: sourceVersion?.sourceFileMtimeMs ?? null
        });
        await sendJsonMaybeWithEtag(response, { entries: exactEntries }, hydrationEtag, jsonResponseOptions);
        return;
      }

      setRequestMetrics(response, {
        agentSessionId,
        cachedMissCount: exactRead.cachedMissCount,
        endpoint: "agent.transcript-entries",
        etagHit: false,
        readEntryCount: exactRead.readEntryCount,
        readMode: exactRead.readEntryCount === 0 ? "exact-entry-miss-cache" : "exact-entry-miss",
        requestedEntryCount: entryIds.length,
        returnedEntryCount: 0,
        sourceFileSizeBytes: sourceVersion?.sourceFileSizeBytes ?? null,
        sourceFileMtimeMs: sourceVersion?.sourceFileMtimeMs ?? null
      });
      await sendJsonMaybeWithEtag(response, { entries: [] }, hydrationEtag, jsonResponseOptions);
    } catch (error) {
      next(error);
    }
  };

  app.get("/api/agents/sessions/:agentSessionId/transcript-entries", handleAgentSessionTranscriptEntriesRequest);
  app.post("/api/agents/sessions/:agentSessionId/transcript-entries", handleAgentSessionTranscriptEntriesRequest);

  app.get("/api/agents/sessions/:agentSessionId/transcript-page", async (request, response, next) => {
    try {
      if (!requireHeavyAgentRouteBudget(request, response, "agent.transcript-page")) return;

      const beforeEntryId = readOptionalStringQuery(request.query.beforeEntryId);
      const limit = Math.min(
        readPositiveIntegerQuery(request.query.limit) ?? DEFAULT_AGENT_SESSION_TRANSCRIPT_PAGE_LIMIT,
        MAX_AGENT_SESSION_TRANSCRIPT_PAGE_LIMIT
      );
      if (!beforeEntryId) {
        response.status(400).json({ error: "beforeEntryId is required." });
        return;
      }

      const sourceVersion = await tryReadAgentSessionSourceVersion(
        sourceAgentSessions,
        request.params.agentSessionId
      );
      const hydrationEtag = sourceVersion
        ? buildAgentSessionHydrationEtag(sourceVersion, "agent.transcript-page", {
            beforeEntryId,
            limit
          })
        : null;
      if (sourceVersion && hydrationEtag && sendNotModifiedIfMatched(request, response, hydrationEtag)) {
        setRequestMetrics(response, {
          agentSessionId: request.params.agentSessionId,
          endpoint: "agent.transcript-page",
          etagHit: true,
          readMode: "source-version",
          sourceFileSizeBytes: sourceVersion.sourceFileSizeBytes,
          sourceFileMtimeMs: sourceVersion.sourceFileMtimeMs
        });
        return;
      }

      const boundedPage = await buildBoundedTranscriptPageFromExactEntries({
        agentSessionId: request.params.agentSessionId,
        beforeEntryId,
        limit,
        sourceAgentSessions
      });
      if (boundedPage) {
        const hasPreviousSourceWindow =
          !boundedPage.hasMore && hasPreviousTranscriptSourceWindow(beforeEntryId);
        setRequestMetrics(response, {
          agentSessionId: request.params.agentSessionId,
          endpoint: "agent.transcript-page",
          etagHit: false,
          hasMore: boundedPage.hasMore || hasPreviousSourceWindow,
          readMode: "exact-window",
          returnedEntryCount: boundedPage.entries.length,
          sourceFileSizeBytes: sourceVersion?.sourceFileSizeBytes ?? null,
          sourceFileMtimeMs: sourceVersion?.sourceFileMtimeMs ?? null
        });
        await sendJsonMaybeWithEtag(response, {
          ...boundedPage,
          hasMore: boundedPage.hasMore || hasPreviousSourceWindow
        }, hydrationEtag, jsonResponseOptions);
        return;
      }

      const previousWindowPage = await buildTranscriptPageFromPreviousSourceWindow({
        agentSessionId: request.params.agentSessionId,
        beforeEntryId,
        limit,
        sourceAgentSessions
      });
      if (previousWindowPage) {
        setRequestMetrics(response, {
          agentSessionId: request.params.agentSessionId,
          endpoint: "agent.transcript-page",
          etagHit: false,
          hasMore: previousWindowPage.hasMore,
          readMode: "previous-source-window",
          returnedEntryCount: previousWindowPage.entries.length,
          sourceFileSizeBytes: sourceVersion?.sourceFileSizeBytes ?? null,
          sourceFileMtimeMs: sourceVersion?.sourceFileMtimeMs ?? null
        });
        await sendJsonMaybeWithEtag(response, previousWindowPage, hydrationEtag, jsonResponseOptions);
        return;
      }

      const session = await sourceAgentSessions.getSessionDetail(request.params.agentSessionId, false);
      if (!session) {
        response.status(404).json({ error: "Agent session not found." });
        return;
      }

      const page = buildTranscriptPage(session, beforeEntryId, limit);
      setRequestMetrics(response, {
        agentSessionId: request.params.agentSessionId,
        endpoint: "agent.transcript-page",
        etagHit: false,
        hasMore: page.hasMore,
        readMode: "full-detail-fallback",
        returnedEntryCount: page.entries.length,
        sourceFileSizeBytes: sourceVersion?.sourceFileSizeBytes ?? null,
        sourceFileMtimeMs: sourceVersion?.sourceFileMtimeMs ?? null
      });
      await sendJsonMaybeWithEtag(response, page, hydrationEtag, jsonResponseOptions);
    } catch (error) {
      next(error);
    }
  });
}
