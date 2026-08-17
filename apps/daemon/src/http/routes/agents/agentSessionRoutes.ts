import type express from "express";

import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

import { installAgentSessionLifecycleRoutes } from "./session/sessionLifecycleRoutes.ts";
import { installAgentSessionReadRoutes } from "./session/sessionReadRoutes.ts";
import type { DecorateSession } from "../../types.ts";
import { installAgentSessionTranscriptRoutes } from "./session/transcript/routes.ts";

type InstallAgentSessionRoutesOptions = {
  decorateSession: DecorateSession;
  httpCompression?: "auto" | "off";
  sourceAgentSessions: SourceAgentSessionService;
};

/**
 * Stable composition entry point for the source-agent HTTP surface.
 *
 * Domain-specific registrars live below `routes/agents/session/`; keeping this
 * facade small prevents transport details from leaking into the daemon
 * composition root.
 */
export function installAgentSessionRoutes(
  app: express.Express,
  options: InstallAgentSessionRoutesOptions
) {
  installAgentSessionReadRoutes(app, options);
  installAgentSessionTranscriptRoutes(app, options);
  installAgentSessionLifecycleRoutes(app, options);
}
