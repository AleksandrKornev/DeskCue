import type express from "express";
import { createHash } from "node:crypto";

import type { SessionDetail, SessionSummary } from "@deskcue/protocol";
import { getErrorResponse } from "#application/errors";
import type { ManagedSessionService } from "#application/managedSessionService";
import type { ManualCommandService } from "#application/manualCommands/manualCommandService";
import { logger } from "#infrastructure/logging/logger";

import { syncReplyStateForManagedSession } from "./replyStateSync.ts";
import {
  readCapturePreviewArtifactPayload,
  readCreateSessionInput,
  readExternalForceStopPayload,
  readRunManualCommandInput,
  readSendInputPayload,
  readSetPreviewPortPayload
} from "../../middleware/validators.ts";
import type { DecorateSession } from "../../types.ts";

type InstallSessionRoutesOptions = {
  decorateSession: DecorateSession;
  manualCommands: ManualCommandService;
  managedSessions: ManagedSessionService;
};

type SessionDetailView = "chat" | "debug" | "diff";

type SessionDetailFormatOptions = {
  debugLogTail: number | null;
  view: SessionDetailView | null;
};

function shouldIncludeDiffForGitRefresh(view: SessionDetailView | null) {
  return view === null || view === "diff";
}

function stripSessionSummaryGitDetails(session: SessionSummary): SessionSummary {
  if (!session.git.diff && session.git.changedFiles.length === 0) {
    return session;
  }

  return {
    ...session,
    git: {
      ...session.git,
      changedFiles: [],
      diff: ""
    }
  };
}

function toSessionSummary(session: SessionDetail): SessionSummary {
  const summary = { ...session } as Partial<SessionDetail>;
  delete summary.logs;
  delete summary.inputHistory;

  return stripSessionSummaryGitDetails(summary as SessionSummary);
}

function formatSessionResponse(session: SessionDetail, request: express.Request) {
  if (request.query.compact !== "1") {
    return session;
  }

  return toSessionSummary(session);
}

function ifNoneMatchHeaderMatches(value: string | string[] | undefined, etag: string) {
  const rawValue = Array.isArray(value) ? value.join(",") : value;
  if (!rawValue) {
    return false;
  }

  return rawValue.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized === etag;
  });
}

function buildSessionViewEtag(session: SessionDetail, view: SessionDetailView) {
  const comparableSession = {
    ...session,
    lastActivityAt: view === "diff" ? "" : session.lastActivityAt,
    git: {
      ...session.git,
      lastUpdatedAt: ""
    }
  };
  return `W/"${createHash("sha1").update(JSON.stringify(comparableSession)).digest("base64url")}"`;
}

function readDebugLogTail(request: express.Request) {
  const value = request.query.logTail;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }

  return Math.max(1, Math.min(Number(value), 200));
}

function formatSessionDetailResponse(
  session: SessionDetail,
  { debugLogTail, view }: SessionDetailFormatOptions
) {
  if (!view) {
    return session;
  }

  if (view === "chat") {
    return {
      ...session,
      git: {
        ...session.git,
        diff: ""
      },
      logs: [],
      inputHistory: []
    };
  }

  if (view === "debug") {
    return {
      ...session,
      git: {
        ...session.git,
        diff: ""
      },
      logs: debugLogTail === null ? session.logs : session.logs.slice(-debugLogTail)
    };
  }

  return {
    ...session,
    logs: [],
    inputHistory: []
  };
}

function readSessionDetailView(request: express.Request): SessionDetailView | null {
  const view = request.query.view;
  return view === "chat" || view === "debug" || view === "diff" ? view : null;
}

function sendSessionDetailResponse(
  response: express.Response,
  request: express.Request,
  session: SessionDetail
) {
  const view = readSessionDetailView(request);
  const payload = formatSessionDetailResponse(session, {
    debugLogTail: readDebugLogTail(request),
    view
  });
  if (!view) {
    response.json(payload);
    return;
  }

  const etag = buildSessionViewEtag(payload, view);
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("ETag", etag);
  if (ifNoneMatchHeaderMatches(request.headers["if-none-match"], etag)) {
    response.status(304).end();
    return;
  }

  response.json(payload);
}

export function installSessionRoutes(
  app: express.Express,
  { decorateSession, managedSessions, manualCommands }: InstallSessionRoutesOptions
) {
  app.get("/api/sessions", (_request, response) => {
    response.json(managedSessions.listSessions().map((session) => decorateSession(session)));
  });

  app.get("/api/sessions/:sessionId", async (request, response, next) => {
    try {
      const syncedSession = await syncReplyStateForManagedSession(
        managedSessions,
        request.params.sessionId
      );
      const session = syncedSession ?? managedSessions.getSession(request.params.sessionId);
      if (!session) {
        response.status(404).json({
          error: "Session not found."
        });
        return;
      }

      sendSessionDetailResponse(response, request, decorateSession(session));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions", async (request, response, next) => {
    try {
      const body = readCreateSessionInput(request.body);
      logger.info("Session start requested", {
        workspaceId: body.workspaceId,
        commandLength: body.command.length
      });
      const session = await managedSessions.startSession(body);
      response.status(201).json(decorateSession(session));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/manual-command", async (request, response, next) => {
    try {
      const body = readRunManualCommandInput(request.body);
      logger.info("Manual command requested", {
        workspaceId: body.workspaceId,
        commandLength: body.command.length
      });

      response.json(await manualCommands.run(body.workspaceId, body.command));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:sessionId/input", async (request, response, next) => {
    try {
      const body = readSendInputPayload(request.body);
      logger.info("Session input requested", {
        sessionId: request.params.sessionId,
        inputLength: body.input.length
      });
      const session = await managedSessions.sendInput(request.params.sessionId, body.input);
      response.json(formatSessionResponse(decorateSession(session), request));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:sessionId/stop", async (request, response, next) => {
    try {
      logger.info("Session stop requested", {
        sessionId: request.params.sessionId
      });
      const session = await managedSessions.stopSession(request.params.sessionId);
      response.json(formatSessionResponse(decorateSession(session), request));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:sessionId/interrupt", async (request, response, next) => {
    try {
      logger.info("Session prompt interrupt requested", {
        sessionId: request.params.sessionId
      });
      const session = await managedSessions.interruptSession(request.params.sessionId);
      response.json(formatSessionResponse(decorateSession(session), request));
    } catch (error) {
      const errorResponse = getErrorResponse(error);
      if (errorResponse.code === "external_desktop_interrupt_unavailable") {
        response.json({
          kind: "external_desktop_fallback",
          code: errorResponse.code,
          action: "open_on_host",
          message: errorResponse.message
        });
        return;
      }
      next(error);
    }
  });

  app.get("/api/sessions/:sessionId/external-claude-background-stop-capability", async (request, response, next) => {
    try {
      response.json(
        await managedSessions.getExternalClaudeBackgroundStopCapability(request.params.sessionId)
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:sessionId/external-claude-background-stop", async (request, response, next) => {
    try {
      logger.warn("External Claude Code background stop requested", {
        sessionId: request.params.sessionId
      });
      const session = await managedSessions.stopExternalClaudeBackground(request.params.sessionId);
      response.json(formatSessionResponse(decorateSession(session), request));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sessions/:sessionId/external-force-stop-capability", async (request, response, next) => {
    try {
      response.json(
        await managedSessions.getExternalForceStopCapability(request.params.sessionId)
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:sessionId/external-force-stop", async (request, response, next) => {
    try {
      const body = readExternalForceStopPayload(request.body);
      logger.warn("External Codex process force stop requested", {
        sessionId: request.params.sessionId,
        processId: body.processId
      });
      const session = await managedSessions.forceStopExternalProcess(request.params.sessionId, body);
      response.json(formatSessionResponse(decorateSession(session), request));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sessions/:sessionId/external-desktop-interrupt-capability", async (request, response, next) => {
    try {
      response.json(
        await managedSessions.getExternalDesktopInterruptCapability(request.params.sessionId)
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:sessionId/external-desktop-interrupt", async (request, response, next) => {
    try {
      logger.warn("External Codex Desktop interrupt requested", {
        sessionId: request.params.sessionId
      });
      const session = await managedSessions.interruptExternalDesktopSession(request.params.sessionId);
      response.json(formatSessionResponse(decorateSession(session), request));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:sessionId/external-desktop-open", async (request, response, next) => {
    try {
      logger.info("External Codex Desktop chat open requested", {
        sessionId: request.params.sessionId
      });
      await managedSessions.openExternalCodexDesktopChat(request.params.sessionId);
      response.json({ requested: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:sessionId/preview", async (request, response, next) => {
    try {
      const body = readSetPreviewPortPayload(request.body);
      logger.info("Session preview update requested", {
        sessionId: request.params.sessionId,
        port: body.port,
        networkMode: body.networkMode
      });
      const session = await managedSessions.setPreviewPort(
        request.params.sessionId,
        body.port,
        body.networkMode
      );
      response.json(decorateSession(session));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:sessionId/preview/artifacts", async (request, response, next) => {
    try {
      const body = readCapturePreviewArtifactPayload(request.body);
      logger.info("Session preview artifact capture requested", {
        sessionId: request.params.sessionId,
        viewport: body.viewport
      });
      const session = await managedSessions.capturePreviewArtifact(
        request.params.sessionId,
        body
      );
      response.status(201).json(decorateSession(session));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:sessionId/refresh-git", async (request, response, next) => {
    try {
      const view = readSessionDetailView(request);
      logger.info("Session git refresh requested", {
        sessionId: request.params.sessionId,
        view
      });
      const session = await managedSessions.refreshSessionGit(request.params.sessionId, {
        includeDiff: shouldIncludeDiffForGitRefresh(view)
      });
      const decoratedSession = decorateSession(session);
      if (request.query.compact === "1") {
        response.json(formatSessionResponse(decoratedSession, request));
        return;
      }

      sendSessionDetailResponse(response, request, decoratedSession);
    } catch (error) {
      next(error);
    }
  });
}
