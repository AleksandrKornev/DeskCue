import type express from "express";

import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";
import { readDaemonLogTail } from "#infrastructure/logging/daemonLogReader";

import { readRequestMetricSnapshots } from "../../../middleware/requestLogger.ts";

function readLimit(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export function installDaemonLogRoutes(
  app: express.Express,
  sourceAgentSessions: SourceAgentSessionService
) {
  app.get("/api/daemon/logs", async (request, response) => {
    response.json(await readDaemonLogTail(readLimit(request.query.limit)));
  });

  app.get("/api/daemon/request-metrics", (_request, response) => {
    response.json(readRequestMetricSnapshots());
  });

  app.get("/api/daemon/source-agent-index", (_request, response) => {
    response.json(sourceAgentSessions.readIndexStats());
  });
}
