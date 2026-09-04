import type { SubmitEvent } from "react";

import type { WorkspaceActionResult } from "@modules/dashboard/model/dashboardViewModel";

export type AddWorkspaceActionProps = {
  canOpenNativeDialogs: boolean;
  loading: boolean;
  pickingWorkspace: boolean;
  workspacePath: string;
  onAddWorkspace: (event: SubmitEvent<HTMLFormElement>) => Promise<WorkspaceActionResult>;
  onChangeWorkspacePath: (value: string) => void;
  onPickWorkspace: () => Promise<WorkspaceActionResult>;
};
