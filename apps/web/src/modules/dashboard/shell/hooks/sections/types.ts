import type { FormEvent } from "react";

import type {
  AgentKind,
  AgentTranscriptChangesResponse,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTranscriptSourceRefs,
  PreviewNetworkMode,
  RuntimeSummary,
  SessionDetail,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import type { AgentSessionsLoadState } from "@models/agentSessions/contracts";
import type { SourceCard } from "@models/dashboard/sourceCards";
import type { OverlayMode } from "@models/dashboardRoute";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import type { PendingChatPrompt, SendInputOptions } from "@models/promptDelivery";
import type { SessionTab } from "@models/sessionTabs";
import type { InitialManagedSessionLoadState } from "@modules/dashboard/model/data";
import type { DashboardState } from "@modules/dashboard/shell/hooks/types";
import type { AttachedManagedSessionInfo } from "@modules/transcript";

export type DashboardShellSectionProps = {
  agentSessions: AgentSessionSummary[];
  agentSessionsTotalCountLabel: string;
  agentSessionsHasMore: boolean;
  agentSessionsLoadState: AgentSessionsLoadState;
  agentSessionsQuery: string | null;
  filteredAgentSessions: AgentSessionSummary[];
  readyForReviewAgentSessionIds: string[];
  sourceCards: SourceCard[];
  effectiveSelectedSourceId: AgentKind | "all";
  effectiveSelectedAgentSessionId: string;
  selectedAgentSession: AgentSessionDetail | null;
  isAgentSessionLoading: boolean;
  isOpeningSelectedAgentSession: boolean;
  attachedManagedSessionId: string | null;
  attachedManagedSessionInfo: AttachedManagedSessionInfo | null;
  isBootstrapping: boolean;
  managedSessions: SessionSummary[];
  effectiveSelectedSessionId: string;
  initialManagedSessionLoadState: InitialManagedSessionLoadState;
  selectedSession: SessionDetail | null;
  takenOverAgentSession: AgentSessionDetail | null;
  agentTranscriptHasMoreById: Map<string, boolean>;
  isTakenOverAgentSessionLoading: boolean;
  liveUpdatesConnection: LiveUpdatesConnectionState;
  activeTab: SessionTab;
  previewPort: string;
  pendingChatPrompt: PendingChatPrompt | null;
  isWaitingForChatReply: boolean;
  isInterruptingPrompt: boolean;
  immediateInterruptPrompt: PendingChatPrompt | null;
  showLiveTools: boolean;
  workspacePath: string;
  loading: boolean;
  pickingWorkspace: boolean;
  canOpenNativeDialogs: boolean;
  selectedWorkspaceId: string;
  workspaces: WorkspaceSummary[];
  command: string;
  runtimes: RuntimeSummary[];
  hasManagedFocus: boolean;
  isDashboardPinned: boolean;
  activeLiveOverlay: OverlayMode;
  onSelectSource: (sourceId: AgentKind | "all") => void;
  onLoadMoreAgentSessions: (
    query?: string,
    options?: { sourceId?: AgentKind | "all" }
  ) => Promise<AgentSessionSummary[]>;
  onReloadAgentSessions: (
    options?: { sourceId?: AgentKind | "all" }
  ) => Promise<AgentSessionSummary[]>;
  onSearchAgentSessions: (
    query: string,
    options?: { silent?: boolean; sourceId?: AgentKind | "all" }
  ) => Promise<AgentSessionSummary[]>;
  onMarkAgentSessionReviewed: (sessionId: string) => void;
  onSelectAgentSession: (sessionId: string) => void;
  onClearAgentSessionSelection: () => void;
  onAttachSelectedAgentSession: () => void;
  onOpenManagedSession: (sessionId: string) => void;
  onOpenLocalLlmChat: (chatId: string) => void;
  onSelectManagedSession: (sessionId: string) => void;
  onSelectSessionTab: (tab: SessionTab) => void;
  onSendInput: (instruction: string, options?: SendInputOptions) => Promise<boolean>;
  onHydrateAgentSessionTranscriptEntries: (
    agentSessionId: string,
    entryIds: string[]
  ) => Promise<AgentSessionDetail["transcript"]>;
  onHydrateAgentSessionChanges: (
    agentSessionId: string,
    groupId: string,
    sourceRefs?: AgentTranscriptSourceRefs
  ) => Promise<AgentTranscriptChangesResponse>;
  onLoadMoreAgentSessionTranscript: (agentSessionId: string, beforeEntryId: string) => Promise<number>;
  onInterruptPrompt: () => void;
  onStopSession: () => boolean | Promise<boolean>;
  onStopAndExitSession: () => void | Promise<void>;
  onExitSession: () => void;
  onRefreshGit: () => void;
  onRetryInitialManagedSessionLoad?: () => Promise<unknown>;
  onChangePreviewPort: (value: string) => void;
  onChangePreviewNetworkMode: (value: PreviewNetworkMode) => boolean | Promise<boolean>;
  onSetPreview: (event: FormEvent<HTMLFormElement>) => void;
  onStopPreview: () => boolean | Promise<boolean>;
  onToggleLiveTools: () => void;
  onChangeWorkspacePath: (value: string) => void;
  onPickWorkspace: () => void;
  onAddWorkspace: (event: FormEvent<HTMLFormElement>) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onChangeCommand: (value: string) => void;
  onStartSession: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onCloseLiveOverlays: () => void;
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
  route: {
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
  routeActions: {
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
};
