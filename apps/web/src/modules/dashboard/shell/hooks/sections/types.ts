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
  takenOverAgentSession: AgentSessionDetail | null;
};

type DashboardShellRouteActions = {
  onAttachSelectedAgentSession: () => void;
  onClearAgentSessionSelection: () => void;
  onCloseLiveOverlays: () => void;
  onExitSession: () => void;
  onInterruptPrompt: () => void;
  onOpenManagedSession: (sessionId: string) => void;
  onOpenLocalLlmChat: (chatId: string) => void;
  onSelectAgentSession: (sessionId: string) => void;
  onSelectManagedSession: (sessionId: string) => void;
  onSelectSessionTab: (tab: SessionTab) => void;
  onSelectSource: (sourceId: AgentKind | "all") => void;
  onSendInput: (instruction: string, options?: SendInputOptions) => Promise<boolean>;
  onStopAndExitSession: () => void | Promise<void>;
  onStopSession: () => boolean | Promise<boolean>;
  onToggleLiveTools: () => void;
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
    | "onClearAgentSessionSelection"
    | "onOpenLocalLlmChat"
    | "onOpenManagedSession"
    | "onSelectAgentSession"
    | "onSelectSource"
  >;
};

export type BuildManagedSessionShellPropsArgs = {
  overview: DashboardSlice<"overview", "isBootstrapping">;
  agentBrowser: DashboardSlice<"agentBrowser", "agentSessions" | "agentTranscriptHasMoreById">;
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
    | "takenOverAgentSession"
  >;
  routeActions: Pick<
    DashboardShellRouteActions,
    | "onExitSession"
    | "onInterruptPrompt"
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
