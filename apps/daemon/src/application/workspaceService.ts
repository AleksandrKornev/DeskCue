import type { WorkspaceSummary } from "@deskcue/protocol";

import type { WorkspaceBackend } from "./ports.ts";
import { requireNonEmptyString } from "./serviceValidation.ts";

export class WorkspaceService {
  constructor(private readonly backend: WorkspaceBackend) {}

  listWorkspaces(): WorkspaceSummary[] {
    return this.backend.listWorkspaces();
  }

  createWorkspace(workspacePath: string): Promise<WorkspaceSummary> {
    return this.backend.createWorkspace(requireNonEmptyString(workspacePath, "path"));
  }
}
