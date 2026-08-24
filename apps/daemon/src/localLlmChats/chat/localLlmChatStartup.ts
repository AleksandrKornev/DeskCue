import { lstat } from "node:fs/promises";
import path from "node:path";

import type { LocalLlmChatWorkspace } from "@deskcue/protocol";
import { AppError } from "#application/errors";
import { logger } from "#infrastructure/logging/logger";

import type { LocalLlmChatLibrary } from "../storage/localLlmChatLibrary.ts";
import { recoverPendingLocalLlmUnifiedDiff } from "../tools/localLlmUnifiedDiff.ts";
import { resolveLocalLlmWorkspaceRoot } from "../tools/localLlmWorkspaceFilesystem.ts";

function isMissingPathError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export type LocalLlmChatWorkspaceResolver = {
  listWorkspaces: () => import("@deskcue/protocol").WorkspaceSummary[];
};

export function resolveLocalLlmChatWorkspace(
  workspaces: LocalLlmChatWorkspaceResolver | undefined,
  workspaceId: string | null
): LocalLlmChatWorkspace | null {
  if (workspaceId === null) return null;

  const workspace = workspaces?.listWorkspaces().find((item) => item.id === workspaceId);

  if (!workspace) throw new AppError("not_found", "Workspace not found.");

  return { id: workspace.id, name: workspace.name, path: workspace.path };
}

export async function recoverLocalLlmChatStartup(
  library: LocalLlmChatLibrary,
  workspaces: LocalLlmChatWorkspaceResolver | undefined
) {
  await library.recoverInterruptedStreams();
  const workspacePaths = [...new Set((workspaces?.listWorkspaces() ?? []).map((workspace) => workspace.path))];

  for (const workspacePath of workspacePaths) {
    try {
      await lstat(path.join(workspacePath, ".deskcue-data", "local-llm-patches"));
      const root = await resolveLocalLlmWorkspaceRoot(workspacePath);

      await recoverPendingLocalLlmUnifiedDiff(root);
    } catch (error) {
      if (isMissingPathError(error)) continue;

      logger.warn("Local LLM patch recovery could not inspect a workspace", {
        message: error instanceof Error ? error.message : String(error),
        workspacePath
      });
    }
  }
}
