import type express from "express";

import type { PickWorkspaceResult } from "@deskcue/protocol";
import type { WorkspaceService } from "#application/workspaceService";
import { logger } from "#infrastructure/logging/logger";
import { pickWorkspacePath } from "#infrastructure/picker";

import { isTrustedLoopbackBrowserRequest } from "../../hostClient.ts";
import { readCreateWorkspaceInput } from "../../middleware/validators.ts";

type InstallWorkspaceRoutesOptions = {
  workspaces: WorkspaceService;
};

export function installWorkspaceRoutes(
  app: express.Express,
  { workspaces }: InstallWorkspaceRoutesOptions
) {
  app.get("/api/workspaces", (_request, response) => {
    response.json(workspaces.listWorkspaces());
  });

  app.post("/api/workspaces", async (request, response, next) => {
    try {
      const body = readCreateWorkspaceInput(request.body);
      logger.info("Workspace create requested", {
        path: body.path
      });
      const workspace = await workspaces.createWorkspace(body.path);
      response.status(201).json(workspace);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/workspaces/pick", async (request, response, next) => {
    try {
      if (!isTrustedLoopbackBrowserRequest(request)) {
        response.status(403).json({
          error: "Folder picker is only available from DeskCue on this computer."
        });
        return;
      }

      logger.info("Workspace picker requested");
      const result = await pickWorkspacePath();
      if (result.cancelled || !result.path) {
        logger.info("Workspace picker cancelled");
        const payload: PickWorkspaceResult = {
          cancelled: true,
          path: null
        };
        response.json(payload);
        return;
      }

      const workspace = await workspaces.createWorkspace(result.path);
      logger.info("Workspace picked and registered", {
        path: result.path,
        workspaceId: workspace.id,
        workspaceName: workspace.name
      });
      response.status(201).json({
        cancelled: false,
        path: result.path,
        workspace
      });
    } catch (error) {
      next(error);
    }
  });
}
