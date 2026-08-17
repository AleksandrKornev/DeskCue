import type express from "express";

import { parseWorkspaceDirectoryQuery, parseWorkspaceFileQuery } from "@deskcue/protocol";
import type { WorkspaceFileService } from "#workspaces/files/workspaceFileService";

import { readProtocolPayload } from "../../middleware/validators.ts";

type InstallWorkspaceFileRoutesOptions = {
  workspaceFiles: WorkspaceFileService;
};

export function installWorkspaceFileRoutes(
  app: express.Express,
  { workspaceFiles }: InstallWorkspaceFileRoutesOptions
) {
  app.get("/api/workspaces/:workspaceId/files", async (request, response, next) => {
    try {
      const query = readProtocolPayload(() => parseWorkspaceDirectoryQuery(request.query));
      response.json(await workspaceFiles.listDirectory(request.params.workspaceId, query));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workspaces/:workspaceId/file", async (request, response, next) => {
    try {
      const query = readProtocolPayload(() => parseWorkspaceFileQuery(request.query));
      response.json(await workspaceFiles.readFile(request.params.workspaceId, query));
    } catch (error) {
      next(error);
    }
  });
}
