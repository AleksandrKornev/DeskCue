import type express from "express";

import {
  hydrateBoundedExactTranscriptView,
  readBoundedExactTranscriptSession
} from "./hydration/exactViewHydration.ts";
import { requireHeavyAgentRouteBudget, tryReadAgentSessionSourceVersion } from "./routeHelpers.ts";
import {
  buildTranscriptViewDelta,
  buildTranscriptViewDeltaEtag,
  buildTranscriptViewDeltaSourceVersionEtag,
  toAgentSessionSummary,
  transcriptHttpCache,
  tryBuildLightweightTranscriptUpdates,
  tryBuildTranscriptUpdatesFromSourceTailWindow
} from "./view/projection.ts";
import { readTranscriptDeltaRouteRequest } from "./view/routeRequest.ts";
import type { TranscriptViewRouteDependencies } from "./view/routeRequest.ts";
import {
  sendAgentSessionNotFound,
  sendTranscriptJsonWithEtag,
  sendTranscriptNotModifiedIfMatched
} from "./view/routeResponse.ts";
import { setRequestMetrics } from "../../../../middleware/requestLogger.ts";
import {
  buildTranscriptViewCacheKey,
  shouldCacheTranscriptViewForSourceVersion
} from "../../../../transcript/agentTranscriptHttpCache.ts";

export function installTranscriptDeltaRoute(
  app: express.Express,
  { jsonResponseOptions, sourceAgentSessions }: TranscriptViewRouteDependencies
) {
  app.get("/api/agents/sessions/:agentSessionId/transcript-updates", async (request, response, next) => {
    try {
      if (!requireHeavyAgentRouteBudget(request, response, "agent.transcript-updates")) {
        return;
      }

      const {
        baseItemKey,
        baseSourceEntryId,
        chatMessageTail,
        fullTranscript,
        includeSessionSummary,
        overlapItemCount,
        transcriptDetail,
        transcriptTail,
        transcriptViewOptions,
        waitingSince
      } = readTranscriptDeltaRouteRequest(request.query);
      const sourceVersion = await tryReadAgentSessionSourceVersion(
        sourceAgentSessions,
        request.params.agentSessionId
      );
      const preflightEtag = sourceVersion
        ? buildTranscriptViewDeltaSourceVersionEtag(sourceVersion, transcriptViewOptions, {
            baseItemKey,
            overlapItemCount
          })
        : null;
      if (
        sourceVersion &&
        preflightEtag &&
        sendTranscriptNotModifiedIfMatched(request, response, preflightEtag)
      ) {
        setRequestMetrics(response, {
          agentSessionId: request.params.agentSessionId,
          baseItemKey,
          endpoint: "agent.transcript-updates",
          etagHit: true,
          etagPhase: "source-version",
          overlapItemCount,
          readMode: "source-version",
          sourceFileSizeBytes: sourceVersion.sourceFileSizeBytes,
          sourceFileMtimeMs: sourceVersion.sourceFileMtimeMs,
          transcriptDetail
        });
        return;
      }

      const transcriptViewCacheKey = sourceVersion &&
        !includeSessionSummary &&
        shouldCacheTranscriptViewForSourceVersion(sourceVersion)
        ? buildTranscriptViewCacheKey(sourceVersion, transcriptViewOptions)
        : null;
      const cachedTranscriptView = transcriptViewCacheKey
        ? transcriptHttpCache.readView(transcriptViewCacheKey)
        : null;
      if (cachedTranscriptView && preflightEtag && sourceVersion) {
        const delta = buildTranscriptViewDelta(cachedTranscriptView.view, {
          baseItemKey,
          overlapItemCount
        });
        setRequestMetrics(response, {
          agentSessionId: request.params.agentSessionId,
          baseItemKey,
          cacheHit: true,
          endpoint: "agent.transcript-updates",
          etagHit: false,
          etagPhase: "source-version-miss",
          itemCount: delta.items.length,
          overlapItemCount,
          readMode: "source-version+view-cache",
          replaceFromItemKey: delta.replaceFromItemKey,
          sourceFileSizeBytes: sourceVersion.sourceFileSizeBytes,
          sourceFileMtimeMs: sourceVersion.sourceFileMtimeMs,
          transcriptDetail,
          transcriptEntryCount: cachedTranscriptView.transcriptEntryCount
        });
        await sendTranscriptJsonWithEtag(
          response,
          includeSessionSummary
            ? {
                ...delta,
                session: sourceVersion.summary
              }
            : delta,
          preflightEtag,
          jsonResponseOptions
        );
        return;
      }

      const lightweightDelta = await tryBuildLightweightTranscriptUpdates({
        agentSessionId: request.params.agentSessionId,
        baseItemKey,
        baseSourceEntryId,
        fullTranscript,
        includeSessionSummary,
        overlapItemCount,
        sourceAgentSessions,
        sourceVersion,
        transcriptDetail,
        transcriptTail,
        waitingSince
      });
      if (lightweightDelta && preflightEtag && sourceVersion) {
        setRequestMetrics(response, {
          agentSessionId: request.params.agentSessionId,
          baseItemKey,
          baseSourceEntryId,
          cacheHit: false,
          endpoint: "agent.transcript-updates",
          etagHit: false,
          etagPhase: "source-version-miss",
          itemCount: lightweightDelta.items.length,
          overlapItemCount,
          readMode: "source-version+source-window",
          replaceFromItemKey: lightweightDelta.replaceFromItemKey,
          sourceFileSizeBytes: sourceVersion.sourceFileSizeBytes,
          sourceFileMtimeMs: sourceVersion.sourceFileMtimeMs,
          transcriptDetail,
          transcriptEntryCount: lightweightDelta.transcriptEntryCount
        });
        await sendTranscriptJsonWithEtag(
          response,
          lightweightDelta.delta,
          preflightEtag,
          jsonResponseOptions
        );
        return;
      }

      const tailWindowDelta = await tryBuildTranscriptUpdatesFromSourceTailWindow({
        agentSessionId: request.params.agentSessionId,
        baseItemKey,
        baseSourceEntryId,
        chatMessageTail,
        fullTranscript,
        includeSessionSummary,
        overlapItemCount,
        sourceAgentSessions,
        sourceVersion,
        transcriptDetail,
        transcriptTail,
        waitingSince
      });
      if (tailWindowDelta && preflightEtag && sourceVersion) {
        setRequestMetrics(response, {
          agentSessionId: request.params.agentSessionId,
          baseItemKey,
          baseSourceEntryId,
          cacheHit: false,
          endpoint: "agent.transcript-updates",
          etagHit: false,
          etagPhase: "source-version-miss",
          itemCount: tailWindowDelta.items.length,
          overlapItemCount,
          readMode: "source-version+source-tail-window",
          replaceFromItemKey: tailWindowDelta.replaceFromItemKey,
          sourceFileSizeBytes: sourceVersion.sourceFileSizeBytes,
          sourceFileMtimeMs: sourceVersion.sourceFileMtimeMs,
          transcriptDetail,
          transcriptEntryCount: tailWindowDelta.transcriptEntryCount
        });
        await sendTranscriptJsonWithEtag(
          response,
          tailWindowDelta.delta,
          preflightEtag,
          jsonResponseOptions
        );
        return;
      }

      const exactTranscript = await readBoundedExactTranscriptSession({
        agentSessionId: request.params.agentSessionId,
        chatMessageTail,
        sourceAgentSessions,
        transcriptTail
      });
      if (!exactTranscript) {
        sendAgentSessionNotFound(response);
        return;
      }

      const { detailReadMode, responseSession } = exactTranscript;
      const transcriptUpdatesEtag =
        preflightEtag ?? buildTranscriptViewDeltaEtag(responseSession, transcriptViewOptions, {
          baseItemKey,
          overlapItemCount
        });
      if (!preflightEtag && sendTranscriptNotModifiedIfMatched(request, response, transcriptUpdatesEtag)) {
        setRequestMetrics(response, {
          agentSessionId: request.params.agentSessionId,
          baseItemKey,
          endpoint: "agent.transcript-updates",
          etagHit: true,
          etagPhase: "detail",
          overlapItemCount,
          readMode: "bounded-detail",
          transcriptDetail
        });
        return;
      }

      const transcriptView = await hydrateBoundedExactTranscriptView({
        agentSessionId: request.params.agentSessionId,
        responseSession,
        sourceAgentSessions,
        sourceVersion,
        transcriptDetail,
        transcriptHttpCache,
        waitingSince
      });
      if (transcriptViewCacheKey) {
        transcriptHttpCache.setView(
          transcriptViewCacheKey,
          transcriptView,
          responseSession.transcript.length
        );
      }
      const delta = buildTranscriptViewDelta(transcriptView, {
        baseItemKey,
        overlapItemCount
      });
      setRequestMetrics(response, {
        agentSessionId: request.params.agentSessionId,
        baseItemKey,
        cacheHit: false,
        endpoint: "agent.transcript-updates",
        etagHit: false,
        etagPhase: preflightEtag ? "source-version-miss" : "detail-miss",
        itemCount: delta.items.length,
        overlapItemCount,
        readMode: preflightEtag
          ? `source-version+${detailReadMode ?? "bounded-detail"}`
          : detailReadMode ?? "bounded-detail",
        replaceFromItemKey: delta.replaceFromItemKey,
        sourceFileSizeBytes: sourceVersion?.sourceFileSizeBytes ?? null,
        sourceFileMtimeMs: sourceVersion?.sourceFileMtimeMs ?? null,
        transcriptDetail,
        transcriptEntryCount: responseSession.transcript.length
      });

      await sendTranscriptJsonWithEtag(
        response,
        includeSessionSummary
          ? {
              ...delta,
              session: toAgentSessionSummary(responseSession)
            }
          : delta,
        transcriptUpdatesEtag,
        jsonResponseOptions
      );
    } catch (error) {
      next(error);
    }
  });
}
