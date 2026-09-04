import type { SubmitEvent } from "react";
import { toast } from "sonner";

import type { WorkspaceActionResult } from "@modules/dashboard/model/dashboardViewModel";
import { INITIAL_MANAGED_SESSION_RECOVERY_MESSAGE } from "@modules/dashboard/model/data/helpers";
import type { AgentBrowserShellProps } from "@modules/dashboard/shell/AgentBrowserShell";
import type { ManagedSessionShellProps } from "@modules/dashboard/shell/ManagedSessionShell";
import type { SecondaryToolsShellProps } from "@modules/dashboard/shell/SecondaryToolsShell";

import { buildAgentCliRuntimeRows } from "./agentCliRuntimeRows";
import type {
  BuildAgentBrowserShellPropsArgs,
  BuildManagedSessionShellPropsArgs,
  BuildSecondaryToolsShellPropsArgs
} from "./types";

function reportWorkspaceActionFailure(result: WorkspaceActionResult) {
  if (result.status === "failed") toast.error(result.error);
}

async function runManualWorkspacePicker(
  action: () => Promise<WorkspaceActionResult>
) {
  reportWorkspaceActionFailure(await action());
}

async function runManualWorkspaceAdd(
  action: (event: SubmitEvent<HTMLFormElement>) => Promise<WorkspaceActionResult>,
  event: SubmitEvent<HTMLFormElement>
) {
  reportWorkspaceActionFailure(await action(event));
}

export function buildAgentBrowserShellProps({
  overview,
  agentBrowser,
  managedSession,
  manualRunner,
  prompt,
  agentBrowserActions,
  manualRunnerActions,
  agentBrowserLoaders,
  route,
  routeActions
}: BuildAgentBrowserShellPropsArgs): AgentBrowserShellProps {
  return {
    totalAgentSessionsCount: agentBrowser.agentSessionsTotalCountLabel,
    agentSessions: agentBrowser.filteredAgentSessions,
    agentSessionsHasMore: agentBrowser.agentSessionsHasMore,
    agentSessionsLoadState: agentBrowser.agentSessionsLoadState,
    agentSessionsQuery: agentBrowser.agentSessionsQuery,
    runtimes: overview.visibleRuntimes,
    workspaces: overview.overview.workspaces,
    readyForReviewAgentSessionIds: agentBrowser.readyForReviewAgentSessionIds,
    managedSessions: managedSession.managedSessions,
    pendingChatPrompt: prompt.pendingChatPrompt,
    sourceCards: overview.sourceCards,
    selectedSourceId: route.effectiveSelectedSourceId,
    selectedAgentSessionId: route.effectiveSelectedAgentSessionId,
    selectedAgentSession: agentBrowser.selectedAgentSession,
    selectedAgentSessionLoadError: agentBrowser.selectedAgentSessionLoadError,
    isAgentSessionLoading: agentBrowser.isAgentSessionLoading,
    attaching: route.isOpeningSelectedAgentSession,
    attachedManagedSessionId: route.attachedManagedSessionId,
    attachedManagedSessionInfo: route.attachedManagedSessionInfo,
    isBootstrapping: overview.isBootstrapping,
    workspacePath: manualRunner.workspacePath,
    workspaceLoading: manualRunner.workspaceLoading,
    pickingWorkspace: manualRunner.workspacePicking,
    canOpenNativeDialogs: overview.canOpenNativeDialogs,
    onSelectSource: routeActions.onSelectSource,
    onLoadMoreAgentSessions: agentBrowserLoaders.loadMoreAgentSessions,
    onReloadAgentSessions: agentBrowserLoaders.loadAgentSessions,
    onRetrySelectedAgentSession: agentBrowserActions.refreshSelectedAgentSession,
    onSearchAgentSessions: agentBrowserLoaders.searchAgentSessions,
    onMarkAgentSessionReviewed: agentBrowserActions.markAgentSessionReviewed,
    onSelectAgentSession: routeActions.onSelectAgentSession,
    onClearAgentSessionSelection: routeActions.onClearAgentSessionSelection,
    onAttachAgentSession: routeActions.onAttachSelectedAgentSession,
    onOpenManagedSession: routeActions.onOpenManagedSession,
    onOpenLocalLlmChat: routeActions.onOpenLocalLlmChat,
    onChangeWorkspacePath: manualRunnerActions.setWorkspacePath,
    onPickWorkspace: manualRunnerActions.handlePickWorkspaceAction,
    onAddWorkspace: manualRunnerActions.handleAddWorkspaceAction
  };
}

export function buildManagedSessionShellProps({
  overview,
  agentBrowser,
  managedSession,
  prompt,
  agentBrowserActions,
  managedSessionActions,
  route,
  routeActions
}: BuildManagedSessionShellPropsArgs): ManagedSessionShellProps {
  return {
    agentSessions: agentBrowser.agentSessions,
    managedSessions: managedSession.managedSessions,
    selectedSessionId: route.effectiveSelectedSessionId,
    selectedSession: managedSession.selectedSession,
    takenOverAgentSession: route.takenOverAgentSession,
    agentTranscriptHasMoreById: agentBrowser.agentTranscriptHasMoreById,
    agentTranscriptHistoryIncompleteById: agentBrowser.agentTranscriptHistoryIncompleteById,
    isTakenOverAgentSessionLoading: route.isTakenOverAgentSessionLoading,
    liveUpdatesConnection: managedSession.liveUpdatesConnection,
    activeTab: managedSession.activeTab,
    previewPort: managedSession.previewPort,
    isBootstrapping: overview.isBootstrapping,
    sessionLoadError:
      route.initialManagedSessionLoadState.kind === "error" ||
      route.initialManagedSessionLoadState.kind === "missing" ||
      route.initialManagedSessionLoadState.kind === "retrying"
        ? INITIAL_MANAGED_SESSION_RECOVERY_MESSAGE
        : null,
    pendingChatPrompt: prompt.pendingChatPrompt,
    isWaitingForChatReply: prompt.isWaitingForChatReply,
    isInterruptingPrompt: prompt.isInterruptingPrompt,
    immediateInterruptPrompt: prompt.immediateInterruptPrompt,
    onSelectSession: routeActions.onSelectManagedSession,
    onSelectTab: routeActions.onSelectSessionTab,
    onSendInput: routeActions.onSendInput,
    onHydrateAgentSessionChanges: agentBrowserActions.hydrateAgentSessionChanges,
    onHydrateAgentSessionTranscriptEntries: agentBrowserActions.hydrateAgentSessionTranscriptEntries,
    onLoadMoreAgentSessionTranscript: agentBrowserActions.loadMoreAgentSessionTranscript,
    onInterruptPrompt: routeActions.onInterruptPrompt,
    onStopSession: routeActions.onStopSession,
    onStopAndExitSession: routeActions.onStopAndExitSession,
    onExitSession: routeActions.onExitSession,
    onRefreshGit: managedSessionActions.handleRefreshGit,
    onRetrySessionLoad: managedSessionActions.retryInitialManagedSessionLoad,
    onChangePreviewPort: managedSessionActions.setPreviewPort,
    onChangePreviewNetworkMode: managedSessionActions.handleChangePreviewNetworkMode,
    onSetPreview: managedSessionActions.handleSetPreview,
    onStopPreview: managedSessionActions.handleStopPreview
  };
}

export function buildSecondaryToolsShellProps({
  overview,
  agentBrowser,
  manualRunner,
  manualRunnerActions
}: BuildSecondaryToolsShellPropsArgs): SecondaryToolsShellProps {
  return {
    agentCliRuntimes: buildAgentCliRuntimeRows(
      agentBrowser.agentSessions,
      overview.sourceCards,
      overview.visibleRuntimes
    ),
    workspacePath: manualRunner.workspacePath,
    loading: manualRunner.loading || manualRunner.workspaceLoading,
    pickingWorkspace: manualRunner.workspacePicking,
    canOpenNativeDialogs: overview.canOpenNativeDialogs,
    selectedWorkspaceId: manualRunner.selectedWorkspaceId,
    workspaces: overview.overview.workspaces,
    command: manualRunner.command,
    runtimes: overview.visibleRuntimes,
    isBootstrapping: overview.isBootstrapping,
    compact: true,
    presentation: "list",
    onChangeWorkspacePath: manualRunnerActions.setWorkspacePath,
    onPickWorkspace: runManualWorkspacePicker.bind(null, manualRunnerActions.handlePickWorkspaceAction),
    onAddWorkspace: runManualWorkspaceAdd.bind(null, manualRunnerActions.handleAddWorkspaceAction),
    onSelectWorkspace: manualRunnerActions.setSelectedWorkspaceId,
    onChangeCommand: manualRunnerActions.setCommand,
    onStartSession: manualRunnerActions.handleStartSession
  };
}
