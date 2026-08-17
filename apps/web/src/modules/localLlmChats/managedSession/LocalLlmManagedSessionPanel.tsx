import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import type {
  LocalLlmChatDetail,
  PreviewNetworkMode
} from "@deskcue/protocol";
import { localLlmChatsApi } from "@api/endpoint/localLlmChats/endpoints";
import type { PendingChatPrompt, SendInputOptions } from "@models/promptDelivery";
import { isCurrentDeskCuePreviewPort } from "@models/sessionPreview";
import type { SessionTab } from "@models/sessionTabs";
import styles from "@modules/localLlmChats/shared/styles.module.scss";
import sessionChromeStyles from "@modules/session/chrome/styles.module.scss";
import { ManagedSessionPanel } from "@modules/session/index";

import { readLocalLlmError } from "./controllers/helpers";
import { useLmStudioChatController } from "./controllers/useLmStudioChatController";
import { useLocalLlmChatController } from "./controllers/useLocalLlmChatController";
import { LocalLlmChatComposerSupplement } from "./LocalLlmChatComposerSupplement";
import {
  buildLocalSessionAdapter,
  hasMoreLocalLlmHistory
} from "./localLlmManagedSessionAdapter";
import { LocalLlmManagedSessionDialogs } from "./LocalLlmManagedSessionDialogs";
import type { LocalLlmManagedSessionPanelProps } from "./types";

export function LocalLlmManagedSessionPanel({
  chatId,
  runtimes,
  workspaces,
  onExit
}: LocalLlmManagedSessionPanelProps) {
  const {
    detail,
    error,
    historyWindowFull,
    hydrateChangeSet,
    loadEarlierHistory,
    localLiveConnection,
    mutateDetail,
    refresh,
    setError
  } = useLocalLlmChatController(chatId);
  const runtime = detail
    ? runtimes.find((candidate) => candidate.id === detail.runtimeId) ?? null
    : null;
  const [activeTab, setActiveTab] = useState<SessionTab>("overview");
  const [previewPort, setPreviewPort] = useState("");
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [modeDialogOpen, setModeDialogOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState("");
  const [updatingWorkspace, setUpdatingWorkspace] = useState(false);
  const {
    activeRuntime,
    discardPendingPrompt: handleDiscardLmStudioPrompt,
    modelDialogOpen: lmStudioModelDialogOpen,
    models: lmStudioModels,
    selectedModelKey: selectedLmStudioModelKey,
    setModelDialogOpen: setLmStudioModelDialogOpen,
    setSelectedModelKey: setSelectedLmStudioModelKey,
    startAndSendPendingPrompt: handleStartLmStudioAndSend,
    starting: startingLmStudio,
    updateModel: handleLmStudioModelUpdate,
    updatingModel: updatingLmStudioModel
  } = useLmStudioChatController({ chatId, detail, mutateDetail, runtime, setError });

  const pendingLmStudioPrompt = detail?.pendingLmStudioPrompt ?? null;
  const pendingChatPrompt: PendingChatPrompt | null = pendingLmStudioPrompt && detail
    ? {
      requestedAt: pendingLmStudioPrompt.requestedAt,
      sessionId: detail.id,
      status: "not_confirmed",
      text: pendingLmStudioPrompt.text
    }
    : null;

  useEffect(() => {
    setActiveTab("overview");
  }, [chatId]);

  useEffect(() => {
    setPreviewPort(detail?.preview?.port ? String(detail.preview.port) : "");
  }, [chatId, detail?.preview?.port]);

  useEffect(() => {
    if (activeTab !== "diff" || !detail) return;
    const changeSetsNeedingHydration = detail.changeSets.filter((changeSet) => !changeSet.diff);
    if (!changeSetsNeedingHydration.length) return;
    let active = true;
    void Promise.all(changeSetsNeedingHydration.map((changeSet) =>
      hydrateChangeSet(`local-llm:changes:${changeSet.id}`)
    )).catch((hydrateError: unknown) => {
      if (active) setError(readLocalLlmError(hydrateError));
    });
    return () => {
      active = false;
    };
  }, [activeTab, detail, hydrateChangeSet, setError]);

  const sendInput = useCallback(async (text: string, options?: SendInputOptions) => {
    if (!detail || detail.generationState === "waiting_approval" || !text.trim()) {
      return false;
    }

    setError(null);
    if (detail.generationState === "running" && !options?.replaceRunningPrompt) {
      return false;
    }
    try {
      await mutateDetail(async () => {
        if (detail.generationState === "running") {
          await localLlmChatsApi.interrupt(detail.id);
        }
        return localLlmChatsApi.send(detail.id, { text });
      });
      return true;
    } catch (sendError) {
      setError(readLocalLlmError(sendError));
      return false;
    }
  }, [detail, mutateDetail, setError]);

  const handleSendInput = useCallback(
    (text: string, options?: SendInputOptions) => sendInput(text, options),
    [sendInput]
  );

  const handleInterrupt = useCallback(async () => {
    if (!detail || detail.generationState !== "running") {
      return false;
    }

    setError(null);
    try {
      await mutateDetail(() => localLlmChatsApi.interrupt(detail.id));
      return true;
    } catch (interruptError) {
      setError(readLocalLlmError(interruptError));
      return false;
    }
  }, [detail, mutateDetail, setError]);

  const openWorkspaceDialog = useCallback(() => {
    setWorkspaceId(detail?.workspace?.id ?? "");
    setWorkspaceDialogOpen(true);
  }, [detail?.workspace?.id]);

  const handleWorkspaceUpdate = useCallback(async () => {
    if (!detail) {
      return;
    }
    setUpdatingWorkspace(true);
    setError(null);
    try {
      await mutateDetail(() => localLlmChatsApi.updateWorkspace(detail.id, {
        workspaceId: workspaceId || null
      }));
      setWorkspaceDialogOpen(false);
    } catch (workspaceError) {
      setError(readLocalLlmError(workspaceError));
    } finally {
      setUpdatingWorkspace(false);
    }
  }, [detail, mutateDetail, setError, workspaceId]);

  const handleAgentModeUpdate = useCallback(async (agentMode: LocalLlmChatDetail["agentMode"]) => {
    if (!detail || detail.agentMode === agentMode) return;
    setError(null);
    try {
      await mutateDetail(() => localLlmChatsApi.updateAgentMode(detail.id, { agentMode }));
      setModeDialogOpen(false);
    } catch (modeError) {
      setError(readLocalLlmError(modeError));
    }
  }, [detail, mutateDetail, setError]);

  const handleActionResolution = useCallback(async (actionRequestId: string, decision: "approve" | "reject") => {
    if (!detail) return;
    setError(null);
    try {
      await mutateDetail(() => localLlmChatsApi.resolveAction(detail.id, actionRequestId, decision));
    } catch (actionError) {
      setError(readLocalLlmError(actionError));
    }
  }, [detail, mutateDetail, setError]);

  const handleSetPreview = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail) return;
    const normalizedPort = previewPort.trim() ? Number(previewPort) : null;
    if (normalizedPort !== null && (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535)) {
      setError("Preview port must be an integer between 1 and 65535");
      return;
    }
    if (isCurrentDeskCuePreviewPort(normalizedPort, window.location)) {
      setError("Preview target cannot be the DeskCue web app. Choose the port of the app you want to review");
      return;
    }
    setError(null);
    try {
      await mutateDetail(() => localLlmChatsApi.updatePreview(detail.id, {
        networkMode: detail.preview?.networkMode ?? "device-direct",
        port: normalizedPort
      }));
    } catch (previewError) {
      setError(readLocalLlmError(previewError));
    }
  }, [detail, mutateDetail, previewPort, setError]);

  const handleChangePreviewNetworkMode = useCallback(async (networkMode: PreviewNetworkMode) => {
    if (!detail) return false;
    setError(null);
    try {
      await mutateDetail(() => localLlmChatsApi.updatePreview(detail.id, {
        networkMode,
        port: detail.preview?.port ?? null
      }));
      return true;
    } catch (previewError) {
      setError(readLocalLlmError(previewError));
      return false;
    }
  }, [detail, mutateDetail, setError]);

  const handleStopPreview = useCallback(async () => {
    if (!detail) return false;
    setError(null);
    try {
      await mutateDetail(() => localLlmChatsApi.updatePreview(detail.id, {
        networkMode: detail.preview?.networkMode ?? "device-direct",
        port: null
      }));
      return true;
    } catch (previewError) {
      setError(readLocalLlmError(previewError));
      return false;
    }
  }, [detail, mutateDetail, setError]);

  const handleRefreshGit = useCallback(async () => {
    if (!detail) return;
    setError(null);
    try {
      await mutateDetail(() => localLlmChatsApi.refreshGit(detail.id));
    } catch (gitError) {
      setError(readLocalLlmError(gitError));
    }
  }, [detail, mutateDetail, setError]);

  const adapter = useMemo(
    () => detail ? buildLocalSessionAdapter(detail, activeRuntime) : null,
    [activeRuntime, detail]
  );

  if (!adapter) {
    return <div className={styles.empty}>{error ?? "Loading local chat..."}</div>;
  }

  return (
    <div className={styles.managedSession}>
      <ManagedSessionPanel
        activeTab={activeTab}
        agentSessions={[adapter.agentSession]}
        agentTranscriptHasMoreById={new Map([[
          adapter.agentSession.id,
          !historyWindowFull && hasMoreLocalLlmHistory(adapter.detail)
        ]])}
        canSendInputWhenReadOnly
        hasWorkspaceFiles={Boolean(adapter.detail.workspace)}
        hasPreview={Boolean(adapter.detail.workspace || adapter.detail.preview?.active)}
        isBootstrapping={false}
        isInterruptingPrompt={false}
        isTakenOverAgentSessionLoading={false}
        isWaitingForChatReply={adapter.detail.generationState === "running"}
        hideChatComposer={
          Boolean(pendingLmStudioPrompt) ||
          adapter.detail.actionRequests.some((request) => request.status === "pending")
        }
        chatComposerSupplement={
          <LocalLlmChatComposerSupplement
            detail={adapter.detail}
            startingLmStudio={startingLmStudio}
            onDiscardLmStudioPrompt={handleDiscardLmStudioPrompt}
            onResolveAction={(actionRequestId, decision) => void handleActionResolution(actionRequestId, decision)}
            onStartLmStudioAndSend={() => void handleStartLmStudioAndSend()}
          />
        }
        headerMenuItem={
          <>
            <button
              className={sessionChromeStyles.actionMenuItem}
              onClick={openWorkspaceDialog}
              role="menuitem"
              type="button"
            >
              {adapter.detail.workspace ? "Change workspace" : "Attach workspace"}
            </button>
            <button
              className={sessionChromeStyles.actionMenuItem}
              onClick={() => setModeDialogOpen(true)}
              role="menuitem"
              type="button"
            >
              Mode
            </button>
            {adapter.detail.runtimeId === "lm-studio" ? (
              <button
                className={sessionChromeStyles.actionMenuItem}
                onClick={() => setLmStudioModelDialogOpen(true)}
                role="menuitem"
                type="button"
              >
                Change model
              </button>
            ) : null}
          </>
        }
        liveUpdatesConnection={localLiveConnection}
        managedSessions={[adapter.session]}
        pendingChatPrompt={pendingChatPrompt}
        previewPort={previewPort}
        selectedSession={adapter.session}
        selectedSessionId={adapter.session.id}
        showTools={false}
        takenOverAgentSession={adapter.agentSession}
        onChangePreviewPort={setPreviewPort}
        onChangePreviewNetworkMode={handleChangePreviewNetworkMode}
        onExitSession={onExit}
        onHydrateAgentSessionChanges={(_agentSessionId, groupId) => hydrateChangeSet(groupId)}
        onHydrateAgentSessionTranscriptEntries={() => Promise.resolve(adapter.agentSession.transcript)}
        onInterruptPrompt={() => void handleInterrupt()}
        onLoadMoreAgentSessionTranscript={() => loadEarlierHistory()}
        onRefreshGit={() => void handleRefreshGit()}
        onRetrySessionLoad={refresh}
        onSelectSession={() => undefined}
        onSelectTab={setActiveTab}
        onSendInput={handleSendInput}
        onSetPreview={handleSetPreview}
        onStopPreview={handleStopPreview}
        onStopAndExitSession={async () => {
          await handleInterrupt();
          onExit();
        }}
        onStopSession={handleInterrupt}
      />
      <LocalLlmManagedSessionDialogs
        detail={adapter.detail}
        lmStudioModelDialogOpen={lmStudioModelDialogOpen}
        lmStudioModels={lmStudioModels}
        modeDialogOpen={modeDialogOpen}
        selectedLmStudioModelKey={selectedLmStudioModelKey}
        updatingLmStudioModel={updatingLmStudioModel}
        updatingWorkspace={updatingWorkspace}
        workspaceDialogOpen={workspaceDialogOpen}
        workspaceId={workspaceId}
        workspaces={workspaces}
        onAgentModeUpdate={(agentMode) => void handleAgentModeUpdate(agentMode)}
        onCloseLmStudioModelDialog={() => setLmStudioModelDialogOpen(false)}
        onCloseModeDialog={() => setModeDialogOpen(false)}
        onCloseWorkspaceDialog={() => setWorkspaceDialogOpen(false)}
        onLmStudioModelUpdate={() => void handleLmStudioModelUpdate()}
        onSelectedLmStudioModelKeyChange={setSelectedLmStudioModelKey}
        onWorkspaceIdChange={setWorkspaceId}
        onWorkspaceUpdate={() => void handleWorkspaceUpdate()}
      />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
