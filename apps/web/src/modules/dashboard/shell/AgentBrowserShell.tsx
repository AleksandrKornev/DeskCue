import { lazy, Suspense } from "react";
import type { SubmitEvent } from "react";

import type {
  AgentKind,
  AgentSessionDetail,
  AgentSessionSummary,
  RuntimeSummary,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import type { AgentSessionsLoadState } from "@models/agentSessions/contracts";
import type { SourceCard } from "@models/dashboard/sourceCards";
import type { PendingChatPrompt } from "@models/promptDelivery";
import { AgentSessionsPanel } from "@modules/agents";
import type { WorkspaceActionResult } from "@modules/dashboard/model/dashboardViewModel";
import type { AttachedManagedSessionInfo } from "@modules/transcript";
import { getDeskCueRuntime } from "@runtime";

const AddWorkspaceAction = lazy(() => import("./AddWorkspaceAction/AddWorkspaceAction").then(
  (module) => ({ default: module.AddWorkspaceAction })
));

export type AgentBrowserShellProps = {
  totalAgentSessionsCount: string;
  agentSessions: AgentSessionSummary[];
  agentSessionsHasMore: boolean;
  agentSessionsLoadState: AgentSessionsLoadState;
  agentSessionsQuery: string | null;
  runtimes: RuntimeSummary[];
  workspaces: WorkspaceSummary[];
  managedSessions: SessionSummary[];
  pendingChatPrompt: PendingChatPrompt | null;
  sourceCards: SourceCard[];
  selectedSourceId: AgentKind | "all";
  selectedAgentSessionId: string;
  selectedAgentSession: AgentSessionDetail | null;
  selectedAgentSessionLoadError: string | null;
  readyForReviewAgentSessionIds: string[];
  isAgentSessionLoading: boolean;
  attaching: boolean;
  attachedManagedSessionId: string | null;
  attachedManagedSessionInfo: AttachedManagedSessionInfo | null;
  defaultCollapsed?: boolean;
  isBootstrapping: boolean;
  workspacePath: string;
  workspaceLoading: boolean;
  pickingWorkspace: boolean;
  canOpenNativeDialogs: boolean;
  onSelectSource: (sourceId: AgentKind | "all") => void;
  onLoadMoreAgentSessions: (
    query?: string,
    options?: { sourceId?: AgentKind | "all" }
  ) => Promise<AgentSessionSummary[]>;
  onReloadAgentSessions: (options?: { sourceId?: AgentKind | "all" }) => Promise<AgentSessionSummary[]>;
  onRetrySelectedAgentSession: () => void;
  onSearchAgentSessions: (
    query: string,
    options?: { silent?: boolean; sourceId?: AgentKind | "all" }
  ) => Promise<AgentSessionSummary[]>;
  onMarkAgentSessionReviewed: (sessionId: string) => void;
  onBackToParentAgentSession: (parentSessionId: string, childSessionId: string) => void;
  onOpenSubagentSession: (parentSessionId: string, childSessionId: string) => void;
  onSelectAgentSession: (sessionId: string) => void;
  onClearAgentSessionSelection: () => void;
  onAttachAgentSession: (options?: { subagentParentSessionId?: string }) => void;
  onOpenManagedSession: (
    sessionId: string,
    options?: { subagentParentSessionId?: string }
  ) => void;
  onOpenLocalLlmChat: (chatId: string) => void;
  onChangeWorkspacePath: (value: string) => void;
  onPickWorkspace: () => Promise<WorkspaceActionResult>;
  onAddWorkspace: (event: SubmitEvent<HTMLFormElement>) => Promise<WorkspaceActionResult>;
};

export function AgentBrowserShell({
  workspacePath,
  workspaceLoading,
  pickingWorkspace,
  canOpenNativeDialogs,
  onChangeWorkspacePath,
  onPickWorkspace,
  onAddWorkspace,
  ...panelProps
}: AgentBrowserShellProps) {
  const workspaceManagement = getDeskCueRuntime().features.workspaceManagement;
  const secondaryAction = workspaceManagement ? (
    <Suspense fallback={null}>
      <AddWorkspaceAction
        canOpenNativeDialogs={canOpenNativeDialogs}
        loading={workspaceLoading}
        pickingWorkspace={pickingWorkspace}
        workspacePath={workspacePath}
        onAddWorkspace={onAddWorkspace}
        onChangeWorkspacePath={onChangeWorkspacePath}
        onPickWorkspace={onPickWorkspace}
      />
    </Suspense>
  ) : null;

  return <AgentSessionsPanel {...panelProps} secondaryAction={secondaryAction} />;
}
