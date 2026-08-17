import type { FormEvent } from "react";

import type { RuntimeSummary, WorkspaceSummary } from "@deskcue/protocol";
import { SidebarPanels } from "@modules/dashboard/shell/SidebarPanels";

export type SecondaryToolsShellProps = {
  agentCliRuntimes?: RuntimeSummary[];
  workspacePath: string;
  loading: boolean;
  pickingWorkspace: boolean;
  canOpenNativeDialogs: boolean;
  selectedWorkspaceId: string;
  workspaces: WorkspaceSummary[];
  command: string;
  runtimes: RuntimeSummary[];
  isBootstrapping: boolean;
  compact?: boolean;
  presentation?: "cards" | "list";
  onChangeWorkspacePath: (value: string) => void;
  onPickWorkspace: () => void;
  onAddWorkspace: (event: FormEvent<HTMLFormElement>) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onChangeCommand: (value: string) => void;
  onStartSession: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export function SecondaryToolsShell(props: SecondaryToolsShellProps) {
  return <SidebarPanels {...props} />;
}
