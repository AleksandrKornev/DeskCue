import clsx from "clsx";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";

import { isSubagentChat } from "@components/AgentChatBadge";
import {
  getSessionTabsForCapabilities,
  manualCommandNavigationCapabilities,
  resolveAvailableSessionTab,
  restrictSessionNavigationToRuntime,
  sourceChatNavigationCapabilities
} from "@models/sessionTabs";
import { ModelRuntimePanel } from "@modules/modelRuntime";
import { useDeskCueRuntime } from "@runtime";
import { useDeskCueLayoutMode } from "@web/layout";

import {
  LiveSessionActions,
  LiveSessionHeader,
  ManagedSessionSwitcher
} from "./chrome";
import { SessionDiagnosticsDialog } from "./diagnostics";
import { LiveChatOverview } from "./liveChatOverview";
import { ManagedSessionSurface } from "./ManagedSessionSurface";
import {
  ManualSessionChrome,
  ManualSessionOverview
} from "./manualSession";
import { useExternalClaudeBackgroundStopCapability } from "./model/capabilities/useExternalClaudeBackgroundStopCapability";
import { useManagedSessionPanelViewModel } from "./model/useManagedSessionPanelViewModel";
import { SessionOpeningSkeleton } from "./skeleton";
import styles from "./styles.module.scss";
import {
  DiffTabPanel,
  FilesTabPanel,
  LogsTabPanel,
  PreviewTabPanel
} from "./tabs";
import type { ManagedSessionPanelProps } from "./types";

export const ManagedSessionPanel = observer(function ManagedSessionPanel(
  props: ManagedSessionPanelProps
) {
  const {
    agentSessions,
    selectedSessionId,
    takenOverAgentSession,
    activeTab,
    previewPort,
    isBootstrapping,
    liveUpdatesConnection,
    showTools = false,
    onSelectSession,
    onSelectTab,
    onSendInput,
    onInterruptPrompt,
    onStopSession,
    onStopAndExitSession,
    onExitSession,
    onRefreshGit,
    onRetrySessionLoad,
    onChangePreviewPort,
    onChangePreviewNetworkMode,
    onSetPreview,
    onStopPreview,
    onToggleTools,
  } = props;
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [artifactReviewPath, setArtifactReviewPath] = useState("");
  const runtime = useDeskCueRuntime();
  const layoutMode = useDeskCueLayoutMode();

  useEffect(() => {
    setArtifactReviewPath("");
  }, [selectedSessionId]);

  const {
    activeActionRequest,
    activePromptText,
    activeSelectedSession,
    canSendInput,
    chatComposerShellRef,
    chatSurfaceRef,
    chatToolbarRef,
    chatWorkspaceStyle,
    composerPromptInFlight,
    contextCompactionCount,
    debugEntries,
    isCompactViewport,
    isInterruptingPrompt,
    isPromptQueued,
    isTakenOverChat,
    liveChatThreadProps,
    liveHeaderStatus,
    liveHeaderStatusLabel,
    liveSessionSubtitle,
    liveSessionTitle,
    previewReview,
    previewCandidates,
    previewCandidatesError,
    previewCandidatesLoading,
    previewDocumentRevision,
    previewError,
    previewLoading,
    previewRetry,
    previewUrl,
    selectedSessionDetail,
    sessionShell,
    sharedSessionHint,
    sharedViewerCount,
    showModelContext,
    sourceDiffParts,
    switchableManagedSessions,
    setShowModelContext
  } = useManagedSessionPanelViewModel(props);
  const externalClaudeBackgroundStop = useExternalClaudeBackgroundStopCapability(sessionShell);
  const baseNavigationCapabilities = sessionShell?.sourceSessionId
    ? sourceChatNavigationCapabilities
    : manualCommandNavigationCapabilities;
  const navigationCapabilities = restrictSessionNavigationToRuntime({
    ...baseNavigationCapabilities,
    files: props.hasWorkspaceFiles ?? Boolean(sessionShell?.workspaceId),
    preview:
      props.hasPreview ??
      Boolean(
        sessionShell?.preview.active ||
        (sessionShell?.workspaceId && !sessionShell.workspaceId.startsWith("local-runtime:"))
      )
  }, runtime.features);
  const canRefreshGit = runtime.features.gitRefresh === true;
  const launchSessionPreview = runtime.launchSessionPreview;
  const availableSessionTabs = getSessionTabsForCapabilities(navigationCapabilities);
  const hasPreviewTab = availableSessionTabs.some((tab) => tab.key === "preview");
  const effectiveActiveTab = resolveAvailableSessionTab(activeTab, availableSessionTabs);
  const navigationIdPrefix = `managed-session-${sessionShell?.id ?? selectedSessionId}`;
  const handleStopExternalClaudeBackground = async () => {
    await onInterruptPrompt();
    externalClaudeBackgroundStop.refresh();
  };

  useEffect(() => {
    setShowDiagnostics(false);
  }, [selectedSessionId]);

  useEffect(() => {
    if (sessionShell && effectiveActiveTab !== activeTab) onSelectTab(effectiveActiveTab);
  }, [activeTab, effectiveActiveTab, onSelectTab, sessionShell]);

  if (isBootstrapping && !selectedSessionId) return null;

  return (
    <div className={styles.sessionStack}>
      {!isCompactViewport ? (
        <ManagedSessionSwitcher
          agentSessions={agentSessions}
          managedSessions={switchableManagedSessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
        />
      ) : null}

      {!sessionShell && selectedSessionId ? (
        <SessionOpeningSkeleton
          errorMessage={props.sessionLoadError}
          onRetry={onRetrySessionLoad}
        />
      ) : null}

      {sessionShell ? (
        <ManagedSessionSurface sessionShell={sessionShell}>
          <div className={styles.stackLarge}>
            {isTakenOverChat ? (
              <LiveSessionHeader
                activeTab={effectiveActiveTab}
                actions={
                  <LiveSessionActions
                    adapterLabel={takenOverAgentSession?.agentLabel ?? sessionShell.adapterId.toUpperCase()}
                    canStopExternalClaudeBackground={externalClaudeBackgroundStop.isAvailable}
                    compact={isCompactViewport}
                    extraMenuItem={props.headerMenuItem}
                    sessionStatus={sessionShell.status}
                    showTools={showTools}
                    onExitSession={onExitSession}
                    onStopExternalClaudeBackground={handleStopExternalClaudeBackground}
                    onStopSession={onStopSession}
                    onStopAndExitSession={onStopAndExitSession}
                    onToggleModelContext={() => setShowModelContext((current) => !current)}
                    onOpenDiagnostics={() => setShowDiagnostics(true)}
                    onToggleTools={onToggleTools}
                  />
                }
                adapterLabel={sessionShell.adapterId.toUpperCase()}
                agentLabel={takenOverAgentSession?.agentLabel}
                navigationCapabilities={navigationCapabilities}
                navigationIdPrefix={navigationIdPrefix}
                contextCompactionCount={contextCompactionCount}
                isAgentChat={isSubagentChat(takenOverAgentSession)}
                metaItem={props.headerMetaItem}
                onSelectTab={onSelectTab}
                status={liveHeaderStatus}
                statusLabel={liveHeaderStatusLabel}
                liveUpdatesConnection={liveUpdatesConnection}
                subtitle={liveSessionSubtitle}
                title={liveSessionTitle}
                toolbarRef={chatToolbarRef}
              />
            ) : (
              <ManualSessionChrome
                activeSelectedSession={selectedSessionDetail}
                activeTab={effectiveActiveTab}
                navigationCapabilities={navigationCapabilities}
                navigationIdPrefix={navigationIdPrefix}
                onExitSession={onExitSession}
                onRefreshGit={canRefreshGit ? onRefreshGit : undefined}
                onSelectTab={onSelectTab}
                onStopSession={onStopSession}
                sessionShell={sessionShell}
                takenOverAgentSession={takenOverAgentSession}
              />
            )}

            {showModelContext ? (
              <ModelRuntimePanel
                agentSession={takenOverAgentSession}
                onClose={() => setShowModelContext(false)}
                session={selectedSessionDetail ?? sessionShell}
              />
            ) : null}

            {sessionShell.sourceSessionId ? (
              <div
                aria-labelledby={`${navigationIdPrefix}-tab-overview`}
                className={clsx(styles.tabPanel, styles.stackLarge)}
                hidden={effectiveActiveTab !== "overview"}
                id={`${navigationIdPrefix}-panel-overview`}
                role="tabpanel"
              >
                <LiveChatOverview
                  activeSelectedSession={activeSelectedSession}
                  activeTab="overview"
                  chatComposerShellRef={chatComposerShellRef}
                  chatSurfaceRef={chatSurfaceRef}
                  chatWorkspaceStyle={chatWorkspaceStyle}
                  composerSupplement={props.chatComposerSupplement}
                  hideComposer={props.hideChatComposer}
                  composerProps={{
                    activePromptText,
                    actionRequest: activeActionRequest,
                    canSendInput,
                    isPromptInFlight: composerPromptInFlight,
                    isPromptQueued,
                    sharedSessionHint,
                    onInterruptPrompt,
                    onSendInput,
                  }}
                  isCompactViewport={isCompactViewport}
                  isInterruptingPrompt={isInterruptingPrompt}
                  layoutMode={layoutMode}
                  liveUpdatesConnection={liveUpdatesConnection}
                  sessionShell={sessionShell}
                  sharedViewerCount={sharedViewerCount}
                  threadProps={liveChatThreadProps}
                />
              </div>
            ) : effectiveActiveTab === "overview" ? (
              <div
                aria-labelledby={`${navigationIdPrefix}-tab-overview`}
                className={clsx(styles.tabPanel, styles.stackLarge)}
                id={`${navigationIdPrefix}-panel-overview`}
                role="tabpanel"
              >
                <ManualSessionOverview
                  activeSelectedSession={selectedSessionDetail}
                />
              </div>
            ) : null}

            {effectiveActiveTab === "logs" ? (
              <div
                aria-labelledby={`${navigationIdPrefix}-tab-logs`}
                className={styles.tabPanel}
                id={`${navigationIdPrefix}-panel-logs`}
                role="tabpanel"
              >
                <LogsTabPanel
                  activePromptText={activePromptText}
                  actionRequest={activeActionRequest}
                  canSendInput={canSendInput}
                  debugEntries={debugEntries}
                  draftScopeKey={`inline:${selectedSessionDetail?.id ?? sessionShell.id}:${effectiveActiveTab}`}
                  hasSelectedSession={Boolean(selectedSessionDetail)}
                  hasSourceSession={Boolean(sessionShell.sourceSessionId)}
                  isInterruptingPrompt={isInterruptingPrompt}
                  isPromptInFlight={composerPromptInFlight}
                  isPromptQueued={isPromptQueued}
                  onInterruptPrompt={onInterruptPrompt}
                  onSendInput={onSendInput}
                  sharedSessionHint={sharedSessionHint}
                  viewerCount={sharedViewerCount}
                />
              </div>
            ) : null}

            {effectiveActiveTab === "diff" ? (
              <div
                aria-labelledby={`${navigationIdPrefix}-tab-diff`}
                className={clsx(styles.tabPanel, styles.reviewTabPanel)}
                id={`${navigationIdPrefix}-panel-diff`}
                role="tabpanel"
              >
                <DiffTabPanel
                  git={selectedSessionDetail?.git ?? null}
                  preferredFilePath={artifactReviewPath}
                  showWorkspaceGit
                  sourceDiffParts={sourceDiffParts}
                  onOpenFile={navigationCapabilities.files ? (path) => {
                    setArtifactReviewPath(path);
                    onSelectTab("files");
                  } : undefined}
                  onRefreshGit={canRefreshGit ? onRefreshGit : undefined}
                  onSelectFile={setArtifactReviewPath}
                />
              </div>
            ) : null}

            {effectiveActiveTab === "files" ? (
              <div
                aria-labelledby={`${navigationIdPrefix}-tab-files`}
                className={clsx(styles.tabPanel, styles.reviewTabPanel)}
                id={`${navigationIdPrefix}-panel-files`}
                role="tabpanel"
              >
                <FilesTabPanel
                  changedFiles={selectedSessionDetail?.git.changedFiles ?? []}
                  requestedPath={artifactReviewPath}
                  workspaceId={sessionShell.workspaceId?.startsWith("local-runtime:")
                    ? null
                    : sessionShell.workspaceId}
                  workspaceName={sessionShell.workspaceName}
                  onOpenChanges={(path) => {
                    setArtifactReviewPath(path);
                    onSelectTab("diff");
                  }}
                  onSelectFile={setArtifactReviewPath}
                />
              </div>
            ) : null}

            {hasPreviewTab ? (
              <div
                aria-labelledby={`${navigationIdPrefix}-tab-preview`}
                className={clsx(styles.tabPanel, styles.reviewTabPanel)}
                hidden={effectiveActiveTab !== "preview"}
                id={`${navigationIdPrefix}-panel-preview`}
                role="tabpanel"
              >
                <PreviewTabPanel
                configuredPreviewPort={sessionShell.preview.port}
                configuredPreviewNetworkMode={sessionShell.preview.networkMode}
                hasSelectedSession={Boolean(selectedSessionDetail)}
                onChangePreviewPort={onChangePreviewPort}
                onChangePreviewNetworkMode={onChangePreviewNetworkMode}
                onReloadPreview={() => {
                  previewReview.reload();
                }}
                onLaunchPreview={launchSessionPreview && selectedSessionDetail
                  ? () => launchSessionPreview(selectedSessionDetail.id)
                  : undefined}
                onSetPreview={onSetPreview}
                onStopPreview={onStopPreview}
                previewCandidates={previewCandidates}
                previewCandidatesError={previewCandidatesError}
                previewCandidatesLoading={previewCandidatesLoading}
                previewDocumentRevision={previewDocumentRevision}
                previewError={previewError}
                previewLoading={previewLoading}
                previewPort={previewPort}
                previewReloadVersion={previewReview.reloadVersion}
                previewUrl={previewUrl}
                onRetryPreview={previewRetry}
                />
              </div>
            ) : null}
          </div>
          <SessionDiagnosticsDialog
            debugEntries={debugEntries}
            hasSelectedSession={Boolean(selectedSessionDetail)}
            isOpen={showDiagnostics}
            sessionId={sessionShell.id.startsWith("local-llm-session:")
              ? null
              : sessionShell.id}
            onClose={() => setShowDiagnostics(false)}
          />
        </ManagedSessionSurface>
      ) : null}
    </div>
  );
});
