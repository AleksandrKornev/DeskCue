import type { ManualCommandResult } from "@deskcue/protocol";
import { ManualCommandCapacityError } from "#sessions/manual/manualCommandRunner";

import { AppError } from "../errors.ts";
import type { ManualCommandRunnerPort } from "../ports.ts";
import type { UpdateAdmissionPort } from "../update/updateAdmission.ts";
import type { WorkspaceService } from "../workspaceService.ts";

export class ManualCommandService {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly runner: ManualCommandRunnerPort,
    private readonly updateAdmission?: UpdateAdmissionPort
  ) {}

  getActiveCommandCount() {
    return this.runner.getActiveCommandCount?.() ?? 0;
  }

  async run(workspaceId: string, command: string): Promise<ManualCommandResult> {
    return this.updateAdmission
      ? this.updateAdmission.run("manual_command", () => this.runAdmitted(workspaceId, command))
      : this.runAdmitted(workspaceId, command);
  }

  close(): Promise<void> {
    return this.runner.close();
  }

  private async runAdmitted(workspaceId: string, command: string) {
    const workspace = this.workspaces
      .listWorkspaces()
      .find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new AppError("not_found", "Workspace not found.");
    }

    try {
      return await this.runner.run(command, workspace.path);
    } catch (error) {
      if (error instanceof ManualCommandCapacityError) {
        throw new AppError("conflict", error.message);
      }

      throw error;
    }
  }
}
