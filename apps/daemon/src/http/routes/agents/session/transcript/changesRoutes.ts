import type express from "express";

import {
  buildAgentSessionHydrationEtag,
  expandTranscriptEntryIdsWithPreviousNeighbors,
  MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL,
  MAX_AGENT_SESSION_TRANSCRIPT_RANGE_ENTRY_IDS,
  readRouteParam,
  readTranscriptSourceEntryIdsRequest,
  requireHeavyAgentRouteBudget,
  tryReadAgentSessionSourceVersion
} from "./routeHelpers.ts";
import type { TranscriptRouteDependencies } from "./routeHelpers.ts";
import { setRequestMetrics } from "../../../../middleware/requestLogger.ts";
import {
  buildAgentTranscriptChangesResponse,
  buildAgentTranscriptChangesResponseFromEntries
} from "../../../../transcript/agentTranscriptView.ts";
import { sendJsonMaybeWithEtag, sendNotModifiedIfMatched } from "../jsonResponse.ts";

export function installTranscriptChangesRoutes(
  app: express.Express,
  {
    jsonResponseOptions,
    sourceAgentSessions,
    transcriptHttpCache
  }: TranscriptRouteDependencies
) {
  const handleAgentSessionChangesRequest: express.RequestHandler = async (request, response, next) => {
    try {
      if (!requireHeavyAgentRouteBudget(request, response, "agent.changes")) return;

      const agentSessionId = readRouteParam(request.params.agentSessionId);
      const groupId = readRouteParam(request.params.groupId);
      const entryIds = readTranscriptSourceEntryIdsRequest(
        request,
        MAX_AGENT_SESSION_TRANSCRIPT_RANGE_ENTRY_IDS
      );
      const sourceVersion = await tryReadAgentSessionSourceVersion(sourceAgentSessions, agentSessionId);
      const hydrationEtag = sourceVersion
        ? buildAgentSessionHydrationEtag(sourceVersion, "agent.changes", {
            entryIds: [...entryIds].sort(),
            groupId
          })
        : null;
      if (sourceVersion && hydrationEtag && sendNotModifiedIfMatched(request, response, hydrationEtag)) {
        setRequestMetrics(response, {
          agentSessionId,
          endpoint: "agent.changes",
          etagHit: true,
          groupId,
          readMode: "source-version",
          requestedEntryCount: entryIds.length,
          sourceFileSizeBytes: sourceVersion.sourceFileSizeBytes,
          sourceFileMtimeMs: sourceVersion.sourceFileMtimeMs
        });
        return;
      }

      if (entryIds.length > 0) {
        const exactRead = await transcriptHttpCache.readEntries(
          sourceAgentSessions,
          agentSessionId,
          expandTranscriptEntryIdsWithPreviousNeighbors(entryIds),
          sourceVersion
        );
        const changes = buildAgentTranscriptChangesResponseFromEntries(
          agentSessionId,
          groupId,
          exactRead.entries
        );
        if (changes) {
          setRequestMetrics(response, {
            agentSessionId,
            cachedMissCount: exactRead.cachedMissCount,
            endpoint: "agent.changes",
            etagHit: false,
            fileCount: changes.files.length,
            groupId,
            readMode: "exact-entry",
            readEntryCount: exactRead.readEntryCount,
            requestedEntryCount: entryIds.length,
            sourceFileSizeBytes: sourceVersion?.sourceFileSizeBytes ?? null,
            sourceFileMtimeMs: sourceVersion?.sourceFileMtimeMs ?? null
          });
          await sendJsonMaybeWithEtag(response, changes, hydrationEtag, jsonResponseOptions);
          return;
        }
      }

      const session = await sourceAgentSessions.getSessionDetail(
        agentSessionId,
        false,
        undefined,
        MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL
      );
      if (!session) {
        response.status(404).json({ error: "Agent session not found." });
        return;
      }

      const changes = buildAgentTranscriptChangesResponse(
        sourceAgentSessions.reconcileAttachedSession(session),
        groupId
      );
      if (!changes) {
        setRequestMetrics(response, {
          agentSessionId,
          endpoint: "agent.changes",
          groupId,
          readMode: "bounded-detail-miss",
          requestedEntryCount: entryIds.length
        });
        response.status(404).json({ error: "Transcript changes group not found." });
        return;
      }

      setRequestMetrics(response, {
        agentSessionId,
        endpoint: "agent.changes",
        etagHit: false,
        fileCount: changes.files.length,
        groupId,
        readMode: "bounded-detail-fallback",
        requestedEntryCount: entryIds.length,
        sourceFileSizeBytes: sourceVersion?.sourceFileSizeBytes ?? null,
        sourceFileMtimeMs: sourceVersion?.sourceFileMtimeMs ?? null
      });
      await sendJsonMaybeWithEtag(response, changes, hydrationEtag, jsonResponseOptions);
    } catch (error) {
      next(error);
    }
  };

  app.get("/api/agents/sessions/:agentSessionId/changes/:groupId", handleAgentSessionChangesRequest);
  app.post("/api/agents/sessions/:agentSessionId/changes/:groupId", handleAgentSessionChangesRequest);
}
