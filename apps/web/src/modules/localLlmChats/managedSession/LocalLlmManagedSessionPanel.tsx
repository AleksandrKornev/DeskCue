import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SubmitEvent } from "react";

import type {
  LocalLlmChatDetail,
  PreviewNetworkMode
} from "@deskcue/protocol";
import { localLlmChatsApi } from "@api/endpoint/localLlmChats/endpoints";
import type { PendingChatPrompt, SendInputOptions } from "@models/promptDelivery";
import {
  isCurrentDeskCuePreviewPort,
  parsePreviewPort
} from "@models/sessionPreview";
import type { SessionTab } from "@models/sessionTabs";
import styles from "@modules/localLlmChats/shared/styles.module.scss";
import sessionChromeStyles from "@modules/session/chrome/styles.module.scss";
import { ManagedSessionPanel } from "@modules/session/index";
import { SessionOpeningSkeleton } from "@modules/session/skeleton";
import type { SessionOpeningRetryContext } from "@modules/session/skeleton";

import { readLocalLlmError } from "./controllers/helpers";
import { useLmStudioChatController } from "./controllers/useLmStudioChatController";
import { useLocalLlmChatController } from "./controllers/useLocalLlmChatController";
import { LocalLlmChatComposerSupplement } from "./LocalLlmChatComposerSupplement";
import {
  buildLocalSessionAdapter,
  hasMoreLocalLlmHistory
} from "./localLlmManagedSessionAdapter";
import { LocalLlmManagedSessionDialogs } from "./LocalLlmManagedSessionDialogs";
import {
  queueLocalLlmPreviewMutation
} from "./localLlmPreviewMutationQueue";
import type {
  LocalLlmPreviewMutationQueue
} from "./localLlmPreviewMutationQueue";
import type { LocalLlmManagedSessionPanelProps } from "./types";

type LocalChatRefresh = ReturnType<typeof useLocalLlmChatController>["refresh"];
type LocalLlmPreviewIntent = {
  currentChatIdRef: { current: string };
  intentEpoch: number;
  mountedRef: { current: boolean };
  previewIntentEpochRef: { current: number };
  targetChatId: string;
};

const RECOVERY_FOCUS_MAX_FRAMES = 8;

function isLocalLlmPreviewIntentCurrent({
  currentChatIdRef,
  intentEpoch,
  mountedRef,
  previewIntentEpochRef,
  targetChatId
}: LocalLlmPreviewIntent) {
  return mountedRef.current &&
    currentChatIdRef.current === targetChatId &&
    previewIntentEpochRef.current === intentEpoch;
}

function focusRecoveredLocalChat(
  targetId: string,
  retryChatId: string,
  retryContext: SessionOpeningRetryContext,
  mountedRef: { current: boolean },
  currentChatIdRef: { current: string },
  currentRefreshRef: { current: LocalChatRefresh },
  retryRefresh: LocalChatRefresh,
  attempt = 0
) {
  window.requestAnimationFrame(() => {
    if (
      !mountedRef.current ||
      currentChatIdRef.current !== retryChatId ||
      currentRefreshRef.current !== retryRefresh ||
      !retryContext.hasFocusOwnership()
    ) return;

    const activeElement = document.activeElement;
    const focusReturnedToDocument =
      activeElement === document.body || activeElement === document.documentElement;
    const retryStillOwnsFocus = activeElement instanceof HTMLElement &&
      activeElement.hasAttribute("data-session-retry-control");

    if (!focusReturnedToDocument && !retryStillOwnsFocus) return;

    const target = document.getElementById(targetId);

    if (target) {
      target.focus();
      return;
    }

    if (attempt < RECOVERY_FOCUS_MAX_FRAMES) {
      focusRecoveredLocalChat(
        targetId,
        retryChatId,
        retryContext,
        mountedRef,
        currentChatIdRef,
        currentRefreshRef,
        retryRefresh,
        attempt + 1
      );
    }
  });
}

export function LocalLlmManagedSessionPanel({
  chatId,
  runtimes,
  workspaces,
  onExit
}: LocalLlmManagedSessionPanelProps) {
  const currentChatIdRef = useRef(chatId);
  const mountedRef = useRef(true);
  const {
    detail: loadedDetail,
    error,
    historyWindowFull,
    hydrateChangeSet,
    loadEarlierHistory,
    localLiveConnection,
    mutateDetail,
    refresh,
    setError
  } = useLocalLlmChatController(chatId);
  const detail = loadedDetail?.id === chatId ? loadedDetail : null;
  const currentRefreshRef = useRef(refresh);
  const serverPreviewNetworkModeRef = useRef<PreviewNetworkMode>("device-direct");
  const runtime = detail
    ? runtimes.find((candidate) => candidate.id === detail.runtimeId) ?? null
    : null;
  const [activeTab, setActiveTab] = useState<SessionTab>("overview");
  const [previewPort, setPreviewPort] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewDraftDirtyRef = useRef(false);
  const previewIntentEpochRef = useRef(0);
  const previewMutationQueueRef = useRef<LocalLlmPreviewMutationQueue>({
    active: null,
    pending: null
  });
  const previewNetworkModeRef = useRef<PreviewNetworkMode>("device-direct");
  const previewNetworkModeDirtyRef = useRef(false);
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
  const recoveryFocusTargetId = `local-llm-session-recovered-${chatId}`;

  currentChatIdRef.current = chatId;
  currentRefreshRef.current = refresh;
  serverPreviewNetworkModeRef.current = detail?.preview?.networkMode ?? "device-direct";

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

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
    setPreviewError(null);
    previewDraftDirtyRef.current = false;
    previewNetworkModeRef.current = "device-direct";
    previewNetworkModeDirtyRef.current = false;
    previewIntentEpochRef.current += 1;
  }, [chatId]);

  useEffect(() => {
    if (previewDraftDirtyRef.current) return;

    setPreviewPort(detail?.preview?.port ? String(detail.preview.port) : "");
  }, [chatId, detail?.preview?.port]);

  useEffect(() => {
    if (previewNetworkModeDirtyRef.current) return;

    previewNetworkModeRef.current = detail?.preview?.networkMode ?? "device-direct";
  }, [chatId, detail?.preview?.networkMode]);

  const handleChangePreviewPort = useCallback((value: string) => {
    previewDraftDirtyRef.current = true;
    previewNetworkModeRef.current = serverPreviewNetworkModeRef.current;
    previewNetworkModeDirtyRef.current = false;
    previewIntentEpochRef.current += 1;
    setPreviewPort(value);
    setPreviewError(null);
  }, []);

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

  const handleSetPreview = useCallback(async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail) return;

    const targetChatId = detail.id;
    const intentEpoch = ++previewIntentEpochRef.current;
    const parsedPort = parsePreviewPort(previewPort);

    if (!parsedPort.ok) return;

    if (isCurrentDeskCuePreviewPort(parsedPort.port, window.location)) {
      setPreviewError("Preview target cannot be the DeskCue web app. Choose the port of the app you want to review");
      return;
    }

    const networkMode = previewNetworkModeRef.current;
    const previewIntent = {
      currentChatIdRef,
      intentEpoch,
      mountedRef,
      previewIntentEpochRef,
      targetChatId
    };

    setPreviewError(null);

    await queueLocalLlmPreviewMutation(
      previewMutationQueueRef,
      () => isLocalLlmPreviewIntentCurrent(previewIntent),
      async () => {
        try {
          await mutateDetail(() => localLlmChatsApi.updatePreview(targetChatId, {
            networkMode,
            port: parsedPort.port
          }));

          if (isLocalLlmPreviewIntentCurrent(previewIntent)) {
            previewDraftDirtyRef.current = false;
            previewNetworkModeDirtyRef.current = false;
          }

          return true;
        } catch (previewError) {
          if (isLocalLlmPreviewIntentCurrent(previewIntent)) {
            previewNetworkModeRef.current = serverPreviewNetworkModeRef.current;
            previewNetworkModeDirtyRef.current = false;
            setPreviewError(readLocalLlmError(previewError));
          }

          return false;
        }
      }
    );
  }, [detail, mutateDetail, previewPort]);

  const handleChangePreviewNetworkMode = useCallback(async (networkMode: PreviewNetworkMode) => {
    if (!detail) return false;

    const parsedPort = parsePreviewPort(previewPort, detail.preview?.port ?? null);

    if (!parsedPort.ok) return false;

    const targetChatId = detail.id;
    const intentEpoch = ++previewIntentEpochRef.current;
    const previewIntent = {
      currentChatIdRef,
      intentEpoch,
      mountedRef,
      previewIntentEpochRef,
      targetChatId
    };

    previewNetworkModeRef.current = networkMode;
    previewNetworkModeDirtyRef.current = true;
    setPreviewError(null);

    return queueLocalLlmPreviewMutation(
      previewMutationQueueRef,
      () => isLocalLlmPreviewIntentCurrent(previewIntent),
      async () => {
        try {
          await mutateDetail(() => localLlmChatsApi.updatePreview(targetChatId, {
            networkMode,
            port: parsedPort.port
          }));

          if (isLocalLlmPreviewIntentCurrent(previewIntent)) {
            previewDraftDirtyRef.current = false;
            previewNetworkModeDirtyRef.current = false;
          }

          return true;
        } catch (previewError) {
          if (isLocalLlmPreviewIntentCurrent(previewIntent)) {
            previewNetworkModeRef.current = serverPreviewNetworkModeRef.current;
            previewNetworkModeDirtyRef.current = false;
            setPreviewError(readLocalLlmError(previewError));
          }

          return false;
        }
      }
    );
  }, [detail, mutateDetail, previewPort]);

  const handleStopPreview = useCallback(async () => {
    if (!detail) return false;

    const targetChatId = detail.id;
    const intentEpoch = ++previewIntentEpochRef.current;
    const networkMode = previewNetworkModeRef.current;
    const previewIntent = {
      currentChatIdRef,
      intentEpoch,
      mountedRef,
      previewIntentEpochRef,
      targetChatId
    };

    setPreviewError(null);

    return queueLocalLlmPreviewMutation(
      previewMutationQueueRef,
      () => isLocalLlmPreviewIntentCurrent(previewIntent),
      async () => {
        try {
          await mutateDetail(() => localLlmChatsApi.updatePreview(targetChatId, {
            networkMode,
            port: null
          }));

          if (isLocalLlmPreviewIntentCurrent(previewIntent)) {
            previewDraftDirtyRef.current = false;
            previewNetworkModeDirtyRef.current = false;
          }

          return true;
        } catch (previewError) {
          if (isLocalLlmPreviewIntentCurrent(previewIntent)) {
            previewNetworkModeRef.current = serverPreviewNetworkModeRef.current;
            previewNetworkModeDirtyRef.current = false;
            setPreviewError(readLocalLlmError(previewError));
          }

          return false;
        }
      }
    );
  }, [detail, mutateDetail]);

  const handleRefreshGit = useCallback(async () => {
    if (!detail) return;

    setError(null);

    try {
      await mutateDetail(() => localLlmChatsApi.refreshGit(detail.id));
    } catch (gitError) {
      setError(readLocalLlmError(gitError));
    }
  }, [detail, mutateDetail, setError]);

  const handleRetryInitialLoad = useCallback(async (retryContext: SessionOpeningRetryContext) => {
    const retryChatId = chatId;
    const retryRefresh = refresh;

    try {
      const nextDetail = await retryRefresh("initial");
      const retryStillCurrent = mountedRef.current &&
        currentChatIdRef.current === retryChatId &&
        currentRefreshRef.current === retryRefresh;

      if (nextDetail?.id === retryChatId && retryStillCurrent) {
        setError(null);

        if (retryContext.hasFocusOwnership()) {
          focusRecoveredLocalChat(
            recoveryFocusTargetId,
            retryChatId,
            retryContext,
            mountedRef,
            currentChatIdRef,
            currentRefreshRef,
            retryRefresh
          );
        }
      }

      return nextDetail;
    } catch (loadError) {
      if (
        mountedRef.current &&
        currentChatIdRef.current === retryChatId &&
        currentRefreshRef.current === retryRefresh
      ) {
        setError(readLocalLlmError(loadError));
      }

      return null;
    }
  }, [chatId, recoveryFocusTargetId, refresh, setError]);

  const adapter = useMemo(
    () => detail ? buildLocalSessionAdapter(detail, activeRuntime) : null,
    [activeRuntime, detail]
  );

  const visibleError = error || previewError;

  if (!adapter) {
    return (
      <SessionOpeningSkeleton
        key={chatId}
        errorMessage={error
          ? "The local chat may have changed or its runtime may be unavailable."
          : null}
        loadingLabel="Loading local chat"
        onExit={onExit}
        onRetry={handleRetryInitialLoad}
      />
    );
  }

  return (
    <div
      aria-label="Local chat loaded"
      className={styles.managedSession}
      id={recoveryFocusTargetId}
      tabIndex={-1}
    >
      <ManagedSessionPanel
        activeTab={activeTab}
        agentSessions={[adapter.agentSession]}
        agentTranscriptHasMoreById={new Map([[
          adapter.agentSession.id,
          !historyWindowFull && hasMoreLocalLlmHistory(adapter.detail)
        ]])}
        agentTranscriptHistoryIncompleteById={new Map([[
          adapter.agentSession.id,
          hasMoreLocalLlmHistory(adapter.detail)
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
        onChangePreviewPort={handleChangePreviewPort}
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
      {visibleError ? <p className={styles.error} role="alert">{visibleError}</p> : null}
    </div>
  );
}
