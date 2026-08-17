import type express from "express";

import {
  buildAgentSessionHydrationEtag,
  MAX_AGENT_SESSION_TRANSCRIPT_RANGE_ENTRY_IDS,
  readRouteParam,
  readTranscriptSourceEntryIdsRequest,
  requireHeavyAgentRouteBudget,
  tryReadAgentSessionSourceVersion
} from "./routeHelpers.ts";
import type { TranscriptRouteDependencies } from "./routeHelpers.ts";
import { setRequestMetrics } from "../../../../middleware/requestLogger.ts";
import {
  buildAgentTranscriptActivityGroupFromEntries,
  findAgentTranscriptActivityGroup
} from "../../../../transcript/agentTranscriptView.ts";
import { sendJsonMaybeWithEtag, sendNotModifiedIfMatched } from "../jsonResponse.ts";

export function installTranscriptActivityRoutes(
  app: express.Express,
  {
    jsonResponseOptions,
    sourceAgentSessions,
    transcriptHttpCache
  }: TranscriptRouteDependencies
) {
  app.get("/api/agents/sessions/:agentSessionId/activity-groups/:groupId", async (request, response, next) => {
    try {
      if (!requireHeavyAgentRouteBudget(request, response, "agent.activity-group")) return;

      const agentSessionId = readRouteParam(request.params.agentSessionId);
      const groupId = readRouteParam(request.params.groupId);
      const entryIds = readTranscriptSourceEntryIdsRequest(
        request,
        MAX_AGENT_SESSION_TRANSCRIPT_RANGE_ENTRY_IDS
      );
      const sourceVersion = await tryReadAgentSessionSourceVersion(sourceAgentSessions, agentSessionId);
      const hydrationEtag = sourceVersion
        ? buildAgentSessionHydrationEtag(sourceVersion, "agent.activity-group", {
            entryIds: [...entryIds].sort(),
            groupId
          })
        : null;
      if (sourceVersion && hydrationEtag && sendNotModifiedIfMatched(request, response, hydrationEtag)) {
        setRequestMetrics(response, {
          agentSessionId,
          endpoint: "agent.activity-group",
          etagHit: true,
          readMode: "source-version",
          sourceFileSizeBytes: sourceVersion.sourceFileSizeBytes,
          sourceFileMtimeMs: sourceVersion.sourceFileMtimeMs
        });
        return;
      }

      if (entryIds.length > 0) {
        const exactRead = await transcriptHttpCache.readEntries(
          sourceAgentSessions,
          agentSessionId,
          entryIds,
          sourceVersion
        );
        const group = buildAgentTranscriptActivityGroupFromEntries(groupId, exactRead.entries);
        if (group) {
          setRequestMetrics(response, {
            agentSessionId,
            cachedMissCount: exactRead.cachedMissCount,
            endpoint: "agent.activity-group",
            entryCount: group.entries.length,
            etagHit: false,
            groupId,
            readEntryCount: exactRead.readEntryCount,
            readMode: "exact-entry",
            requestedEntryCount: entryIds.length,
            sourceFileSizeBytes: sourceVersion?.sourceFileSizeBytes ?? null,
            sourceFileMtimeMs: sourceVersion?.sourceFileMtimeMs ?? null
          });
          await sendJsonMaybeWithEtag(response, {
            sessionId: agentSessionId,
            group
          }, hydrationEtag, jsonResponseOptions);
          return;
        }
      }

      const session = await sourceAgentSessions.getSessionDetail(agentSessionId, false);
      if (!session) {
        response.status(404).json({ error: "Agent session not found." });
        return;
      }

      const group = findAgentTranscriptActivityGroup(
        sourceAgentSessions.reconcileAttachedSession(session),
        groupId
      );
      if (!group) {
        response.status(404).json({ error: "Transcript activity group not found." });
        return;
      }

      setRequestMetrics(response, {
        agentSessionId: session.id,
        endpoint: "agent.activity-group",
        entryCount: group.entries.length,
        etagHit: false,
        groupId,
        readMode: entryIds.length > 0
          ? "exact-entry-miss+full-detail"
          : hydrationEtag ? "source-version+full-detail" : "full-detail",
        sourceFileSizeBytes: sourceVersion?.sourceFileSizeBytes ?? null,
        sourceFileMtimeMs: sourceVersion?.sourceFileMtimeMs ?? null
      });
      await sendJsonMaybeWithEtag(response, {
        sessionId: session.id,
        group
      }, hydrationEtag, jsonResponseOptions);
    } catch (error) {
      next(error);
    }
  });
}
