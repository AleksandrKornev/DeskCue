import type { WorkspaceSummary } from "@deskcue/protocol";

import type { StoreBackedSessionCallbackContext } from "./storeBackedSessionCallbackTypes.ts";

export function createWorkspaceRegistrationCallbacks(
  context: StoreBackedSessionCallbackContext
) {
  return {
    emitServerEvent: context.emitServerEvent,
    findWorkspaceByPath: (workspacePath: string) =>
      context.listWorkspaces().find(
        (workspace) => workspace.path.toLowerCase() === workspacePath.toLowerCase()
      ),
    persistState: context.persistState,
    setWorkspace: (workspace: WorkspaceSummary) => {
      context.repository.setWorkspace(workspace);
    }
  };
}
