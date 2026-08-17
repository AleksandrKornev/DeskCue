import type express from "express";

import type { SessionSummary } from "@deskcue/protocol";
import type { DaemonApplication } from "#application/daemonApplication";

import { isTrustedLoopbackBrowserRequest } from "../../../hostClient.ts";
import { setRequestMetrics } from "../../../middleware/requestLogger.ts";
import type { DecorateSession } from "../../../types.ts";

const DEFAULT_OVERVIEW_SESSION_LIMIT = 16;

type InstallOverviewRoutesOptions = {
  application: DaemonApplication;
  decorateSession: DecorateSession;
};

function limitOverviewSessions(sessions: SessionSummary[], limit: number) {
  const runningSessions = sessions.filter((session) => session.status === "running");
  const runningSessionIds = new Set(runningSessions.map((session) => session.id));
  const recentSessions = sessions
    .filter((session) => !runningSessionIds.has(session.id))
    .slice(0, Math.max(0, limit - runningSessions.length));

  return [...runningSessions, ...recentSessions];
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

function readSessionLimit(value: unknown) {
  if (typeof value !== "string") {
    return DEFAULT_OVERVIEW_SESSION_LIMIT;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_OVERVIEW_SESSION_LIMIT;
  }

  return Math.min(parsed, 200);
}

export function installOverviewRoutes(
  app: express.Express,
  { application, decorateSession }: InstallOverviewRoutesOptions
) {
  app.get("/api/overview", async (request, response, next) => {
    try {
      await application.managedSessions.syncReplyStatesForRunningAttachedSessions();
      const sessionLimit = readSessionLimit(request.query.sessionLimit);
      const sessions = application.managedSessions
        .listSessions()
        .map((session) => stripSessionSummaryGitDetails(decorateSession(session)));
      const limitedSessions = limitOverviewSessions(sessions, sessionLimit);
      setRequestMetrics(response, {
        endpoint: "dashboard.overview",
        managedSessionCount: sessions.length,
        readMode: "managed-session-summary",
        returnedSessionCount: limitedSessions.length,
        sessionLimit
      });

      response.json({
        clientContext: {
          canOpenNativeDialogs: isTrustedLoopbackBrowserRequest(request)
        },
        workspaces: application.workspaces.listWorkspaces(),
        sessions: limitedSessions
      });
    } catch (error) {
      next(error);
    }
  });
}
