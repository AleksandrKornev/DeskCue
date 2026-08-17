import type express from "express";

import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";
import { logger } from "#infrastructure/logging/logger";

import { readResumeCodexSessionInput } from "../../middleware/validators.ts";
import type { DecorateSession } from "../../types.ts";

type InstallCodexSessionRoutesOptions = {
  decorateSession: DecorateSession;
  sourceAgentSessions: SourceAgentSessionService;
};

export function installCodexSessionRoutes(
  app: express.Express,
  { decorateSession, sourceAgentSessions }: InstallCodexSessionRoutesOptions
) {
  app.get("/api/codex/sessions", async (_request, response, next) => {
    try {
      const sessions = await sourceAgentSessions.listCodexSessions();
      response.json(sessions);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/codex/sessions/:sessionId", async (request, response, next) => {
    try {
      const session = await sourceAgentSessions.getCodexSessionDetail(request.params.sessionId);
      if (!session) {
        response.status(404).json({
          error: "Codex session not found."
        });
        return;
      }

      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/codex/sessions/:sessionId/resume", async (request, response, next) => {
    try {
      const body = readResumeCodexSessionInput(request.body);
      logger.info("Codex session resume requested", {
        codexSessionId: request.params.sessionId,
        promptLength: body.prompt?.length ?? 0
      });
      const codexSession = await sourceAgentSessions.getCodexSessionDetail(
        request.params.sessionId
      );
      if (!codexSession) {
        response.status(404).json({
          error: "Codex session not found."
        });
        return;
      }

      const session = await sourceAgentSessions.resumeCodexSession(codexSession, body.prompt);
      response.status(201).json(decorateSession(session));
    } catch (error) {
      next(error);
    }
  });
}
