import type { AgentKind, AgentSessionDetail } from "@deskcue/protocol";
import type { OverlayMode } from "@models/dashboardRoute";
import type { SendInputOptions } from "@models/promptDelivery";
import type { SessionTab } from "@models/sessionTabs";
import type { InitialManagedSessionLoadState } from "@modules/dashboard/model/data";
import type { DashboardState } from "@modules/dashboard/shell/hooks/types";
import type { AttachedManagedSessionInfo } from "@modules/transcript";

type DashboardShellRouteState = {
  activeLiveOverlay: OverlayMode;
  attachedManagedSessionId: string | null;
  attachedManagedSessionInfo: AttachedManagedSessionInfo | null;
  effectiveSelectedAgentSessionId: string;
  effectiveSelectedSessionId: string;
  effectiveSelectedSourceId: AgentKind | "all";
  initialManagedSessionLoadState: InitialManagedSessionLoadState;
  hasManagedFocus: boolean;
  isDashboardPinned: boolean;
  isOpeningSelectedAgentSession: boolean;
  isTakenOverAgentSessionLoading: boolean;
  showLiveTools: boolean;
  subagentParentSessionId: string | null;
  takenOverAgentSession: AgentSessionDetail | null;
};

type DashboardShellRouteActions = {
  onAttachSelectedAgentSession: (options?: { subagentParentSessionId?: string }) => void;
  onBackToParentAgentSession: (parentSessionId: string, childSessionId: string) => void;
  onClearAgentSessionSelection: () => void;
  onCloseLiveOverlays: () => void;
  onExitSession: () => void;
  onInterruptPrompt: () => void;
  onOpenManagedSession: (
    sessionId: string,
    options?: { subagentParentSessionId?: string }
  ) => void;
  onOpenSubagentSession: (parentSessionId: string, childSessionId: string) => void;
  onOpenLocalLlmChat: (chatId: string) => void;
  onSelectAgentSession: (sessionId: string) => void;
  onSelectManagedSession: (sessionId: string) => void;
  onSelectSessionTab: (tab: SessionTab) => void;
  onSelectSource: (sourceId: AgentKind | "all") => void;
  onSendInput: (instruction: string, options?: SendInputOptions) => Promise<boolean>;
  onStopAndExitSession: (options?: {
    subagentParentSessionId?: string;
    subagentSessionId?: string;
  }) => void | Promise<void>;
  onStopSession: () => boolean | Promise<boolean>;
  onToggleLiveTools: (options?: { replace?: boolean }) => void;
};

export type UseDashboardShellSectionsArgs = {
  overview: DashboardState["overview"];
  agentBrowser: DashboardState["agentBrowser"];
  managedSession: DashboardState["managedSession"];
  manualRunner: DashboardState["manualRunner"];
  prompt: DashboardState["prompt"];
  agentBrowserActions: DashboardState["agentBrowserActions"];
  managedSessionActions: DashboardState["managedSessionActions"];
  manualRunnerActions: DashboardState["manualRunnerActions"];
  agentBrowserLoaders: DashboardState["agentBrowserLoaders"];
  route: DashboardShellRouteState;
  routeActions: DashboardShellRouteActions;
};

type DashboardSlice<
  Section extends keyof DashboardState,
  Field extends keyof DashboardState[Section]
> = Pick<DashboardState[Section], Field>;

export type BuildAgentBrowserShellPropsArgs = {
  overview: DashboardSlice<
    "overview",
    "canOpenNativeDialogs" | "isBootstrapping" | "overview" | "sourceCards" | "visibleRuntimes"
  >;
  agentBrowser: DashboardSlice<
    "agentBrowser",
    | "agentSessionsHasMore"
    | "agentSessionsLoadState"
    | "agentSessionsQuery"
    | "agentSessionsTotalCountLabel"
    | "filteredAgentSessions"
    | "isAgentSessionLoading"
    | "readyForReviewAgentSessionIds"
    | "selectedAgentSession"
    | "selectedAgentSessionLoadError"
  >;
  managedSession: DashboardSlice<"managedSession", "managedSessions">;
  manualRunner: DashboardSlice<
    "manualRunner",
    "workspacePath" | "workspaceLoading" | "workspacePicking"
  >;
  prompt: DashboardSlice<"prompt", "pendingChatPrompt">;
  agentBrowserActions: DashboardSlice<
    "agentBrowserActions",
    "markAgentSessionReviewed" | "refreshSelectedAgentSession"
  >;
  manualRunnerActions: DashboardSlice<
    "manualRunnerActions",
    "handleAddWorkspaceAction" | "handlePickWorkspaceAction" | "setWorkspacePath"
  >;
  agentBrowserLoaders: DashboardSlice<
    "agentBrowserLoaders",
    "loadAgentSessions" | "loadMoreAgentSessions" | "searchAgentSessions"
  >;
  route: Pick<
    DashboardShellRouteState,
    | "attachedManagedSessionId"
    | "attachedManagedSessionInfo"
    | "effectiveSelectedAgentSessionId"
    | "effectiveSelectedSourceId"
    | "isOpeningSelectedAgentSession"
  >;
  routeActions: Pick<
    DashboardShellRouteActions,
    | "onAttachSelectedAgentSession"
    | "onBackToParentAgentSession"
    | "onClearAgentSessionSelection"
    | "onOpenLocalLlmChat"
    | "onOpenManagedSession"
    | "onOpenSubagentSession"
    | "onSelectAgentSession"
    | "onSelectSource"
  >;
};

export type BuildManagedSessionShellPropsArgs = {
  overview: DashboardSlice<"overview", "isBootstrapping">;
  agentBrowser: DashboardSlice<
    "agentBrowser",
    "agentSessions" | "agentTranscriptHasMoreById" | "agentTranscriptHistoryIncompleteById"
  >;
  managedSession: DashboardSlice<
    "managedSession",
    "activeTab" | "liveUpdatesConnection" | "managedSessions" | "previewPort" | "selectedSession"
  >;
  prompt: DashboardSlice<
    "prompt",
    "immediateInterruptPrompt" | "isInterruptingPrompt" | "isWaitingForChatReply" | "pendingChatPrompt"
  >;
  agentBrowserActions: DashboardSlice<
    "agentBrowserActions",
    | "hydrateAgentSessionChanges"
    | "hydrateAgentSessionTranscriptEntries"
    | "loadMoreAgentSessionTranscript"
  >;
  managedSessionActions: DashboardSlice<
    "managedSessionActions",
    | "handleChangePreviewNetworkMode"
    | "handleRefreshGit"
    | "handleSetPreview"
    | "handleStopPreview"
    | "retryInitialManagedSessionLoad"
    | "setPreviewPort"
  >;
  route: Pick<
    DashboardShellRouteState,
    | "effectiveSelectedSessionId"
    | "initialManagedSessionLoadState"
    | "isTakenOverAgentSessionLoading"
    | "subagentParentSessionId"
    | "takenOverAgentSession"
  >;
  routeActions: Pick<
    DashboardShellRouteActions,
    | "onExitSession"
    | "onBackToParentAgentSession"
    | "onInterruptPrompt"
    | "onOpenSubagentSession"
    | "onSelectAgentSession"
    | "onSelectManagedSession"
    | "onSelectSessionTab"
    | "onSendInput"
    | "onStopAndExitSession"
    | "onStopSession"
  >;
};

export type BuildSecondaryToolsShellPropsArgs = {
  overview: DashboardSlice<
    "overview",
    "canOpenNativeDialogs" | "isBootstrapping" | "overview" | "sourceCards" | "visibleRuntimes"
  >;
  agentBrowser: DashboardSlice<"agentBrowser", "agentSessions">;
  manualRunner: DashboardSlice<
    "manualRunner",
    | "command"
    | "loading"
    | "selectedWorkspaceId"
    | "workspaceLoading"
    | "workspacePath"
    | "workspacePicking"
  >;
  manualRunnerActions: DashboardSlice<
    "manualRunnerActions",
    | "handleAddWorkspaceAction"
    | "handlePickWorkspaceAction"
    | "handleStartSession"
    | "setCommand"
    | "setSelectedWorkspaceId"
    | "setWorkspacePath"
  >;
};
