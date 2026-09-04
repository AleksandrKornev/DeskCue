import type { SubmitEvent } from "react";

import type {
  AgentKind,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTranscriptChangesResponse,
  AgentTranscriptEntry,
  AgentTranscriptSourceRefs,
  OverviewResponse,
  PreviewNetworkMode,
  RuntimeSummary,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import type { AgentSessionsLoadState } from "@models/agentSessions/contracts";
import type { SourceCard } from "@models/dashboard/sourceCards";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import type { PendingChatPrompt, SendInputOptions } from "@models/promptDelivery";
import type { SessionTab } from "@models/sessionTabs";

import type { LoadOptions } from "./data/dashboardLoad";
import type { InitialManagedSessionLoadState } from "./data/types";

type AgentSessionsLoadOptions = LoadOptions & {
  sourceId?: AgentKind | "all";
};

export type DashboardCacheSnapshot = {
  overview: OverviewResponse;
  agentSessions: AgentSessionSummary[];
  runtimes: RuntimeSummary[];
  selectedSourceId: AgentKind | "all";
  selectedAgentSessionId: string;
  selectedAgentSession: AgentSessionDetail | null;
  readyForReviewAgentSessionIds: string[];
  activeTakenOverAgentSession: AgentSessionDetail | null;
  selectedWorkspaceId: string;
  selectedSessionId: string;
  selectedSession: SessionDetail | null;
  pendingChatPrompt: PendingChatPrompt | null;
  awaitingChatReplySince: string | null;
  isWaitingForChatReply: boolean;
};

export type DashboardOverviewViewModel = {
  overview: OverviewResponse;
  runningCount: number;
  sourceCards: SourceCard[];
  visibleRuntimes: RuntimeSummary[];
  canOpenNativeDialogs: boolean;
  isBootstrapping: boolean;
  initialManagedSessionLoadState: InitialManagedSessionLoadState;
  error: string;
};

export type DashboardAgentBrowserViewModel = {
  agentSessions: AgentSessionSummary[];
  agentSessionsTotalCountLabel: string;
  agentSessionsHasMore: boolean;
  agentSessionsLoadState: AgentSessionsLoadState;
  agentSessionsQuery: string | null;
  selectedSourceId: AgentKind | "all";
  filteredAgentSessions: AgentSessionSummary[];
  selectedAgentSessionId: string;
  selectedAgentSession: AgentSessionDetail | null;
  selectedAgentSessionLoadError: string | null;
  readyForReviewAgentSessionIds: string[];
  isAgentSessionLoading: boolean;
  activeTakenOverAgentSession: AgentSessionDetail | null;
  agentTranscriptHasMoreById: Map<string, boolean>;
  agentTranscriptHistoryIncompleteById: Map<string, boolean>;
  isActiveTakenOverAgentSessionLoading: boolean;
  attachingAgentSessionId: string;
};

export type DashboardManagedSessionViewModel = {
  selectedSessionId: string;
  selectedSession: SessionDetail | null;
  activeTab: SessionTab;
  managedSessions: SessionSummary[];
  previewPort: string;
  liveUpdatesConnection: LiveUpdatesConnectionState;
};

export type DashboardManualRunnerViewModel = {
  loading: boolean;
  workspaceLoading: boolean;
  workspacePicking: boolean;
  workspacePath: string;
  selectedWorkspaceId: string;
  command: string;
};

export type WorkspaceActionResult =
  | { status: "created" }
  | { status: "cancelled" }
  | { status: "failed"; error: string };

export type DashboardPromptViewModel = {
  pendingChatPrompt: PendingChatPrompt | null;
  isWaitingForChatReply: boolean;
  isInterruptingPrompt: boolean;
  immediateInterruptPrompt: PendingChatPrompt | null;
};

export type DashboardAgentBrowserActions = {
  hydrateAgentSessionChanges: (
    agentSessionId: string,
    groupId: string,
    sourceRefs?: AgentTranscriptSourceRefs
  ) => Promise<AgentTranscriptChangesResponse>;
  hydrateAgentSessionTranscriptEntries: (
    agentSessionId: string,
    entryIds: string[]
  ) => Promise<AgentTranscriptEntry[]>;
  loadMoreAgentSessionTranscript: (
    agentSessionId: string,
    beforeEntryId: string
  ) => Promise<number>;
  setSelectedSourceId: (value: AgentKind | "all") => void;
  setSelectedAgentSessionId: (value: string) => void;
  refreshSelectedAgentSession: () => void;
  setSelectedAgentSession: (value: AgentSessionDetail | null) => void;
  markAgentSessionReviewed: (sessionId: string) => void;
};

export type DashboardManagedSessionActions = {
  setSelectedSessionId: (value: string) => void;
  setSelectedSession: (value: SessionDetail | null) => void;
  setActiveTab: (value: SessionTab) => void;
  setPreviewPort: (value: string) => void;
  handleChangePreviewNetworkMode: (value: PreviewNetworkMode) => Promise<boolean>;
  retryInitialManagedSessionLoad?: () => Promise<unknown>;
  handleSendInput: (
    nextInstruction: string,
    options?: SendInputOptions
  ) => Promise<string | false>;
  handleInterruptPrompt: () => Promise<void>;
  handleStopSession: () => Promise<boolean>;
  handleRefreshGit: () => Promise<void>;
  handleSetPreview: (event: SubmitEvent<HTMLFormElement>) => Promise<void>;
  handleStopPreview: () => Promise<boolean>;
};

export type DashboardManualRunnerActions = {
  setWorkspacePath: (value: string) => void;
  setSelectedWorkspaceId: (value: string) => void;
  setCommand: (value: string) => void;
  handleAddWorkspaceAction: (event: SubmitEvent<HTMLFormElement>) => Promise<WorkspaceActionResult>;
  handlePickWorkspaceAction: () => Promise<WorkspaceActionResult>;
  handleStartSession: (event: SubmitEvent<HTMLFormElement>) => Promise<void>;
  handleAttachAgentSession: () => Promise<SessionDetail | null>;
};

export type DashboardAgentBrowserLoaders = {
  loadAgentSessions: (options?: AgentSessionsLoadOptions) => Promise<AgentSessionSummary[]>;
  loadMoreAgentSessions: (
    query?: string,
    options?: AgentSessionsLoadOptions
  ) => Promise<AgentSessionSummary[]>;
  searchAgentSessions: (
    query: string,
    options?: AgentSessionsLoadOptions
  ) => Promise<AgentSessionSummary[]>;
};

export type DeskCueDashboardViewModel = {
  overview: DashboardOverviewViewModel;
  agentBrowser: DashboardAgentBrowserViewModel;
  managedSession: DashboardManagedSessionViewModel;
  manualRunner: DashboardManualRunnerViewModel;
  prompt: DashboardPromptViewModel;
  agentBrowserActions: DashboardAgentBrowserActions;
  managedSessionActions: DashboardManagedSessionActions;
  manualRunnerActions: DashboardManualRunnerActions;
  agentBrowserLoaders: DashboardAgentBrowserLoaders;
};

export function buildDashboardViewModel(
  viewModel: DeskCueDashboardViewModel
): DeskCueDashboardViewModel {
  return viewModel;
}

export function buildDashboardCacheSnapshot(
  snapshot: DashboardCacheSnapshot
): DashboardCacheSnapshot {
  return snapshot;
}
