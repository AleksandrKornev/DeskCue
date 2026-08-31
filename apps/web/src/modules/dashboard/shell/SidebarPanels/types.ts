import type { SubmitEvent } from "react";

import type { RuntimeSummary, WorkspaceSummary } from "@deskcue/protocol";

export interface SidebarPanelsProps {
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
  onAddWorkspace: (event: SubmitEvent<HTMLFormElement>) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onChangeCommand: (value: string) => void;
  onStartSession: (event: SubmitEvent<HTMLFormElement>) => void | Promise<void>;
}

export type ToolIconKind = "manual" | "runtimes" | "agents" | "workspaces";

export type ToolIconProps = {
  className: string;
  kind: ToolIconKind;
};

export type ToolRowProps = {
  active: boolean;
  badge?: string;
  icon: ToolIconKind;
  subtitle: string;
  title: string;
  onClick: () => void;
};

export type ManualRunnerPanelProps = Pick<
  SidebarPanelsProps,
  | "canOpenNativeDialogs"
  | "command"
  | "loading"
  | "onAddWorkspace"
  | "onChangeCommand"
  | "onChangeWorkspacePath"
  | "onPickWorkspace"
  | "onSelectWorkspace"
  | "onStartSession"
  | "pickingWorkspace"
  | "selectedWorkspaceId"
  | "workspacePath"
  | "workspaces"
> & {
  compact: boolean;
  isOpen: boolean;
  isTriggerHidden?: boolean;
  onToggleOpen: () => void;
};

export type LocalRuntimesPanelProps = Pick<
  SidebarPanelsProps,
  "isBootstrapping" | "runtimes"
> & {
  compact: boolean;
  emptyText?: string;
  hideLabel?: string;
  isOpen: boolean;
  isTriggerHidden?: boolean;
  showStatusIndicator?: boolean;
  showLabel?: string;
  subtitle?: string;
  title?: string;
  isStartingLmStudio?: boolean;
  lmStudioControlMessage?: string | null;
  onOpenChat?: (runtime: RuntimeSummary) => void;
  onStartLmStudio?: () => void;
  onToggleOpen: () => void;
};

export type KnownWorkspacesPanelProps = Pick<
  SidebarPanelsProps,
  "isBootstrapping" | "onSelectWorkspace" | "selectedWorkspaceId" | "workspaces"
> & {
  compact: boolean;
  isOpen: boolean;
  isTriggerHidden?: boolean;
  onToggleOpen: () => void;
};
