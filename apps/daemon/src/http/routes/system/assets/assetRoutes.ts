import type express from "express";

import { parseCreateAssetTicketInput } from "@deskcue/protocol";
import type { CreateAssetTicketResponse } from "@deskcue/protocol";
import type { ManagedSessionService } from "#application/managedSessionService";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

import { AssetAccessPolicy } from "./assetAccessPolicy.ts";
import { sendExpiredAssetTicketResponse, sendLocalAssetFile } from "./assetFileResponse.ts";
import { AssetTicketStore } from "./assetTicketStore.ts";

const ASSET_TICKET_TTL_MS = 15 * 60_000;
const MAX_ASSET_TICKETS = 100;

type InstallAssetRoutesOptions = {
  managedSessions?: ManagedSessionService;
  sourceAgentSessions?: SourceAgentSessionService;
  trustedFileRoots?: string[];
  trustedImageRoots?: string[];
  workspaces: {
    listWorkspaces: () => Array<{ id?: string; path: string }>;
  };
};

export function installAssetRoutes(
  app: express.Express,
  {
    managedSessions,
    sourceAgentSessions,
    trustedFileRoots,
    trustedImageRoots,
    workspaces
  }: InstallAssetRoutesOptions
) {
  const assetTickets = new AssetTicketStore(MAX_ASSET_TICKETS, ASSET_TICKET_TTL_MS);
  const accessPolicy = new AssetAccessPolicy({
    listWorkspaces: () => workspaces.listWorkspaces(),
    managedSessions,
    sourceAgentSessions,
    trustedFileRoots,
    trustedImageRoots
  });

  app.post("/api/assets/ticket", async (request, response, next) => {
    try {
      const input = parseCreateAssetTicketInput(request.body);
      const workspaceResolution = input.workspaceId
        ? await accessPolicy.resolveWorkspacePath(input.workspaceId, input.path)
        : null;
      if (workspaceResolution?.error) {
        response.status(workspaceResolution.error.statusCode).json({
          error: workspaceResolution.error.message
        });
        return;
      }

      const normalizedPath = workspaceResolution?.path ?? accessPolicy.normalizePath(input.path);

      if (!normalizedPath) {
        response.status(400).json({
          error: input.kind === "local_image"
            ? "Only absolute image paths are supported."
            : "Only absolute asset paths are supported."
        });
        return;
      }

      const authorization = await accessPolicy.authorizeTicket(
        input.kind,
        normalizedPath,
        {
          agentSessionId: input.agentSessionId,
          managedSessionId: input.managedSessionId,
          workspaceId: input.workspaceId
        }
      );

      if (authorization.error) {
        response.status(authorization.error.statusCode).json({
          error: authorization.error.message
        });
        return;
      }

      const { id: ticket, ticket: storedTicket } = assetTickets.create({
        agentSessionId: input.agentSessionId,
        download: input.download === true,
        kind: input.kind,
        managedSessionId: input.managedSessionId,
        path: authorization.path,
        requestedPath: normalizedPath,
        workspaceId: input.workspaceId
      });
      const payload: CreateAssetTicketResponse = {
        expiresAt: new Date(storedTicket.expiresAt).toISOString(),
        url: `/api/assets/ticket/${encodeURIComponent(ticket)}`
      };

      response.status(201).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/assets/ticket/:ticket", async (request, response, next) => {
    const ticket = assetTickets.read(request.params.ticket);

    if (!ticket) {
      sendExpiredAssetTicketResponse(request, response);
      return;
    }

    try {
      const authorization = await accessPolicy.authorizeTicket(
        ticket.kind,
        ticket.requestedPath,
        {
          agentSessionId: ticket.agentSessionId,
          managedSessionId: ticket.managedSessionId,
          workspaceId: ticket.workspaceId
        }
      );

      if (authorization.error) {
        response.status(authorization.error.statusCode).json({
          error: authorization.error.message
        });
        return;
      }

      if (authorization.path !== ticket.path) {
        response.status(403).json({
          error: "The local asset no longer resolves to the file authorized by this ticket."
        });
        return;
      }

      sendLocalAssetFile(response, authorization.path, ticket.download);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/assets/file", async (request, response, next) => {
    const normalizedPath = accessPolicy.normalizePath(
      typeof request.query.path === "string" ? request.query.path.trim() : ""
    );

    if (!normalizedPath) {
      response.status(400).json({
        error: "Only absolute asset paths are supported."
      });
      return;
    }

    try {
      const authorization = await accessPolicy.authorizeFile(normalizedPath);

      if (authorization.error) {
        response.status(authorization.error.statusCode).json({ error: authorization.error.message });
        return;
      }

      sendLocalAssetFile(response, authorization.path, request.query.download === "1");
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/assets/local-image", async (request, response, next) => {
    const normalizedPath = accessPolicy.normalizePath(
      typeof request.query.path === "string" ? request.query.path.trim() : ""
    );

    if (!normalizedPath) {
      response.status(400).json({
        error: "Only absolute image paths are supported."
      });
      return;
    }

    try {
      const authorization = await accessPolicy.authorizeImage(normalizedPath);

      if (authorization.error) {
        response.status(authorization.error.statusCode).json({ error: authorization.error.message });
        return;
      }

      sendLocalAssetFile(response, authorization.path, false);
    } catch (error) {
      next(error);
    }
  });
}
