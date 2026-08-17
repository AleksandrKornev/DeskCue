import type express from "express";

import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

import type { HttpCompressionMode, JsonResponseOptions } from "../jsonResponse.ts";
import { installTranscriptActivityRoutes } from "./activityRoutes.ts";
import { installTranscriptChangesRoutes } from "./changesRoutes.ts";
import { installTranscriptHistoryRoutes } from "./historyRoutes.ts";
import { transcriptHttpCache } from "./view/projection.ts";
import { installTranscriptViewRoutes } from "./view/routes.ts";

type InstallAgentSessionRoutesOptions = {
  httpCompression?: HttpCompressionMode;
  sourceAgentSessions: SourceAgentSessionService;
};

export function installAgentSessionTranscriptRoutes(
  app: express.Express,
  {
    httpCompression = "auto",
    sourceAgentSessions
  }: InstallAgentSessionRoutesOptions
) {
  transcriptHttpCache.reset();

  const jsonResponseOptions = {
    httpCompression
  } satisfies JsonResponseOptions;
  const dependencies = {
    jsonResponseOptions,
    sourceAgentSessions,
    transcriptHttpCache
  };

  installTranscriptViewRoutes(app, dependencies);
  installTranscriptActivityRoutes(app, dependencies);
  installTranscriptChangesRoutes(app, dependencies);
  installTranscriptHistoryRoutes(app, dependencies);
}
