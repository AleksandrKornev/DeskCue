import type express from "express";

import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

import type { JsonResponseOptions } from "../../jsonResponse.ts";
import { installTranscriptDeltaRoute } from "../deltaRoute.ts";
import { installFullTranscriptViewRoute } from "../fullViewRoute.ts";

export function installTranscriptViewRoutes(
  app: express.Express,
  dependencies: {
    jsonResponseOptions: JsonResponseOptions;
    sourceAgentSessions: SourceAgentSessionService;
  }
) {
  installFullTranscriptViewRoute(app, dependencies);
  installTranscriptDeltaRoute(app, dependencies);
}
