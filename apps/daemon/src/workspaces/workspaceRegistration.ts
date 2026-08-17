import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";

import type { ServerEvent, WorkspaceSummary } from "@deskcue/protocol";
import { inspectGitRepo } from "#infrastructure/git";
import { logger } from "#infrastructure/logging/logger";

export type WorkspaceRegistrationCallbacks = {
  emitServerEvent: (event: ServerEvent) => void;
  findWorkspaceByPath: (workspacePath: string) => WorkspaceSummary | undefined;
  persistState: () => Promise<void>;
  setWorkspace: (workspace: WorkspaceSummary) => void;
};

export async function registerWorkspace(
  callbacks: WorkspaceRegistrationCallbacks,
  rawPath: string
): Promise<WorkspaceSummary> {
  const resolvedPath = path.resolve(rawPath.trim());
  logger.info("Resolving workspace path", {
    rawPath,
    resolvedPath
  });
  await access(resolvedPath);

  const existing = callbacks.findWorkspaceByPath(resolvedPath);
  if (existing) {
    logger.info("Workspace already registered", {
      workspaceId: existing.id,
      path: existing.path
    });
    return existing;
  }

  const repoInfo = await inspectGitRepo(resolvedPath);
  const workspace: WorkspaceSummary = {
    id: randomUUID(),
    name: path.basename(resolvedPath),
    path: resolvedPath,
    isGitRepo: repoInfo.isGitRepo,
    branch: repoInfo.branch,
    createdAt: new Date().toISOString()
  };

  callbacks.setWorkspace(workspace);
  logger.info("Workspace registered", {
    workspaceId: workspace.id,
    name: workspace.name,
    path: workspace.path,
    isGitRepo: workspace.isGitRepo,
    branch: workspace.branch
  });
  callbacks.emitServerEvent({
    type: "workspace.created",
    payload: workspace
  });
  await callbacks.persistState();

  return workspace;
}
