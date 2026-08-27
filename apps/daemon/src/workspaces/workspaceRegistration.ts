import { randomUUID } from "node:crypto";
import { opendir, stat } from "node:fs/promises";
import path from "node:path";

import type { ServerEvent, WorkspaceSummary } from "@deskcue/protocol";
import { AppError } from "#application/errors";
import { inspectGitRepo } from "#infrastructure/git";
import { logger } from "#infrastructure/logging/logger";

export type WorkspaceRegistrationCallbacks = {
  emitServerEvent: (event: ServerEvent) => void;
  findWorkspaceByPath: (workspacePath: string) => WorkspaceSummary | undefined;
  persistState: () => Promise<void>;
  registrationScope: object;
  rollbackWorkspace: (workspaceId: string) => void;
  setWorkspace: (workspace: WorkspaceSummary) => void;
};

const pendingRegistrationsByScope = new WeakMap<
  object,
  Map<string, Promise<WorkspaceSummary>>
>();

function registrationKey(workspacePath: string) {
  return process.platform === "win32" ? workspacePath.toLowerCase() : workspacePath;
}

function pendingRegistrations(scope: object) {
  const existing = pendingRegistrationsByScope.get(scope);

  if (existing) return existing;

  const pending = new Map<string, Promise<WorkspaceSummary>>();

  pendingRegistrationsByScope.set(scope, pending);

  return pending;
}

function readFilesystemErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;
}

function throwWorkspaceDirectoryError(error: unknown): never {
  const code = readFilesystemErrorCode(error);

  if (code === "ENOENT") throw new AppError("invalid_input", "Workspace folder was not found.");
  if (code === "EACCES" || code === "EPERM") throw new AppError("forbidden", "Workspace folder cannot be read.");

  throw new AppError("invalid_input", "Workspace folder could not be validated.");
}

async function validateWorkspaceDirectory(workspacePath: string) {
  try {
    const workspaceStats = await stat(workspacePath);

    if (!workspaceStats.isDirectory()) throw new AppError("invalid_input", "Workspace path must be a directory.");

    const directory = await opendir(workspacePath);

    await directory.close();
  } catch (error) {
    if (error instanceof AppError) throw error;

    throwWorkspaceDirectoryError(error);
  }
}

async function registerWorkspaceOnce(
  callbacks: WorkspaceRegistrationCallbacks,
  rawPath: string,
  resolvedPath: string
): Promise<WorkspaceSummary> {
  logger.info("Resolving workspace path", {
    rawPath,
    resolvedPath
  });

  await validateWorkspaceDirectory(resolvedPath);

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

  try {
    await callbacks.persistState();
  } catch (error) {
    callbacks.rollbackWorkspace(workspace.id);

    throw error;
  }

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

  return workspace;
}

export function registerWorkspace(
  callbacks: WorkspaceRegistrationCallbacks,
  rawPath: string
): Promise<WorkspaceSummary> {
  const resolvedPath = path.resolve(rawPath.trim());
  const key = registrationKey(resolvedPath);
  const scopedPendingRegistrations = pendingRegistrations(callbacks.registrationScope);
  const pending = scopedPendingRegistrations.get(key);

  if (pending) return pending;

  const registration = registerWorkspaceOnce(callbacks, rawPath, resolvedPath);

  scopedPendingRegistrations.set(key, registration);

  return registration.finally(() => {
    if (scopedPendingRegistrations.get(key) !== registration) return;

    scopedPendingRegistrations.delete(key);
  });
}
