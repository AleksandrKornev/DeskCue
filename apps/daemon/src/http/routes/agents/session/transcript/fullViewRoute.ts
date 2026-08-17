import type express from "express";

import {
  hydrateBoundedExactTranscriptView,
  readBoundedExactTranscriptSession
} from "./hydration/exactViewHydration.ts";
import { requireHeavyAgentRouteBudget, tryReadAgentSessionSourceVersion } from "./routeHelpers.ts";
import {
  buildTranscriptViewEtag,
  buildTranscriptViewSourceVersionEtag,
  enrichTranscriptViewSourceVersionSummary,
  toAgentSessionSummary,
  transcriptHttpCache,
  tryBuildTranscriptViewFromSourceTailWindow
} from "./view/projection.ts";
import { readTranscriptViewRouteRequest } from "./view/routeRequest.ts";
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

export function installFullTranscriptViewRoute(
  app: express.Express,
  { jsonResponseOptions, sourceAgentSessions }: TranscriptViewRouteDependencies
) {
  app.get("/api/agents/sessions/:agentSessionId/transcript-view", async (request, response, next) => {
    try {
      if (!requireHeavyAgentRouteBudget(request, response, "agent.transcript-view")) {
        return;
      }

      const {
        chatMessageTail,
        fullTranscript,
        includeSessionSummary,
        transcriptDetail,
        transcriptTail,
        transcriptViewOptions,
        waitingSince
      } = readTranscriptViewRouteRequest(request.query);
      let sourceVersion = await tryReadAgentSessionSourceVersion(
        sourceAgentSessions,
        request.params.agentSessionId
      );
      sourceVersion = await enrichTranscriptViewSourceVersionSummary({
        agentSessionId: request.params.agentSessionId,
        chatMessageTail,
        includeSessionSummary,
        sourceAgentSessions,
        sourceVersion,
        transcriptTail
      });
      const preflightEtag = sourceVersion
        ? buildTranscriptViewSourceVersionEtag(sourceVersion, transcriptViewOptions)
        : null;
      if (
        sourceVersion &&
        preflightEtag &&
        sendTranscriptNotModifiedIfMatched(request, response, preflightEtag)
      ) {
        setRequestMetrics(response, {
          agentSessionId: request.params.agentSessionId,
          endpoint: "agent.transcript-view",
          etagHit: true,
          etagPhase: "source-version",
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
        setRequestMetrics(response, {
          agentSessionId: request.params.agentSessionId,
          cacheHit: true,
          endpoint: "agent.transcript-view",
          etagHit: false,
          etagPhase: "source-version-miss",
          itemCount: cachedTranscriptView.view.items.length,
          readMode: "source-version+view-cache",
          sourceFileSizeBytes: sourceVersion?.sourceFileSizeBytes ?? null,
          sourceFileMtimeMs: sourceVersion?.sourceFileMtimeMs ?? null,
          transcriptDetail,
          transcriptEntryCount: cachedTranscriptView.transcriptEntryCount
        });
        await sendTranscriptJsonWithEtag(
          response,
          includeSessionSummary
            ? {
                ...cachedTranscriptView.view,
                session: sourceVersion.summary
              }
            : cachedTranscriptView.view,
          preflightEtag,
          jsonResponseOptions
        );
        return;
      }

      const tailWindowView = await tryBuildTranscriptViewFromSourceTailWindow({
        agentSessionId: request.params.agentSessionId,
        chatMessageTail,
        fullTranscript,
        sourceAgentSessions,
        sourceVersion,
        transcriptDetail,
        transcriptTail,
        waitingSince
      });
      if (tailWindowView && preflightEtag && sourceVersion) {
        if (transcriptViewCacheKey) {
          transcriptHttpCache.setView(
            transcriptViewCacheKey,
            tailWindowView.transcriptView,
            tailWindowView.transcriptEntryCount
          );
        }
        setRequestMetrics(response, {
          agentSessionId: request.params.agentSessionId,
          cacheHit: false,
          endpoint: "agent.transcript-view",
          etagHit: false,
          etagPhase: "source-version-miss",
          itemCount: tailWindowView.transcriptView.items.length,
          readMode: "source-version+source-tail-window",
          sourceFileSizeBytes: sourceVersion.sourceFileSizeBytes,
          sourceFileMtimeMs: sourceVersion.sourceFileMtimeMs,
          transcriptDetail,
          transcriptEntryCount: tailWindowView.transcriptEntryCount
        });
        await sendTranscriptJsonWithEtag(
          response,
          includeSessionSummary
            ? {
                ...tailWindowView.transcriptView,
                session: tailWindowView.sessionSummary
              }
            : tailWindowView.transcriptView,
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
      const transcriptViewEtag =
        preflightEtag ?? buildTranscriptViewEtag(responseSession, transcriptViewOptions);
      if (!preflightEtag && sendTranscriptNotModifiedIfMatched(request, response, transcriptViewEtag)) {
        setRequestMetrics(response, {
          agentSessionId: request.params.agentSessionId,
          endpoint: "agent.transcript-view",
          etagHit: true,
          etagPhase: "detail",
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
      setRequestMetrics(response, {
        agentSessionId: request.params.agentSessionId,
        cacheHit: false,
        endpoint: "agent.transcript-view",
        etagHit: false,
        etagPhase: preflightEtag ? "source-version-miss" : "detail-miss",
        itemCount: transcriptView.items.length,
        readMode: preflightEtag
          ? `source-version+${detailReadMode ?? "bounded-detail"}`
          : detailReadMode ?? "bounded-detail",
        sourceFileSizeBytes: sourceVersion?.sourceFileSizeBytes ?? null,
        sourceFileMtimeMs: sourceVersion?.sourceFileMtimeMs ?? null,
        transcriptDetail,
        transcriptEntryCount: responseSession.transcript.length
      });

      await sendTranscriptJsonWithEtag(response,
        includeSessionSummary
          ? {
              ...transcriptView,
              session: toAgentSessionSummary(responseSession)
            }
          : transcriptView,
        transcriptViewEtag,
        jsonResponseOptions
      );
    } catch (error) {
      next(error);
    }
  });
}
