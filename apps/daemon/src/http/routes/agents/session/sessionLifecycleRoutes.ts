import type express from "express";
import { performance } from "node:perf_hooks";

import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";
import { logger } from "#infrastructure/logging/logger";

import { readResumeAgentSessionInput } from "../../../middleware/validators.ts";
import type { DecorateSession } from "../../../types.ts";

const ATTACH_AGENT_SESSION_TRANSCRIPT_TAIL = 160;

type InstallAgentSessionLifecycleRoutesOptions = {
  decorateSession: DecorateSession;
  sourceAgentSessions: SourceAgentSessionService;
};

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

export function installAgentSessionLifecycleRoutes(
  app: express.Express,
  { decorateSession, sourceAgentSessions }: InstallAgentSessionLifecycleRoutesOptions
) {
  app.post("/api/agents/sessions/:agentSessionId/attach", async (request, response, next) => {
    try {
      const attachStartedAt = performance.now();
      const body = readResumeAgentSessionInput(request.body);
      logger.info("Agent session attach requested", {
        agentSessionId: request.params.agentSessionId,
        promptLength: body.prompt?.length ?? 0
      });

      const detailStartedAt = performance.now();
      const agentSession = await sourceAgentSessions.getSessionDetail(
        request.params.agentSessionId,
        false,
        ATTACH_AGENT_SESSION_TRANSCRIPT_TAIL
      );
      const detailDurationMs = elapsedMs(detailStartedAt);
      if (!agentSession) {
        logger.info("Agent session attach source lookup missed", {
          agentSessionId: request.params.agentSessionId,
          detailDurationMs,
          totalDurationMs: elapsedMs(attachStartedAt)
        });
        response.status(404).json({
          error: "Agent session not found."
        });
        return;
      }

      const resumeStartedAt = performance.now();
      const session = await sourceAgentSessions.resumeAgentSession(agentSession, body.prompt);
      const resumeDurationMs = elapsedMs(resumeStartedAt);
      logger.info("Agent session attach completed", {
        agentSessionId: request.params.agentSessionId,
        sourceSessionId: agentSession.sourceSessionId,
        attachMode: agentSession.attachMode,
        sessionId: session.id,
        sessionStatus: session.status,
        detailDurationMs,
        resumeDurationMs,
        totalDurationMs: elapsedMs(attachStartedAt)
      });
      response.status(201).json(decorateSession(session));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/agents/sessions/:agentSessionId/reviewed", async (request, response, next) => {
    try {
      response.json(await sourceAgentSessions.markSessionReviewed(request.params.agentSessionId));
    } catch (error) {
      next(error);
    }
  });
}
