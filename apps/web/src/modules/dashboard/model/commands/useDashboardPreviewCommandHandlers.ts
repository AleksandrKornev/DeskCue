import { useCallback } from "react";
import type { FormEvent } from "react";

import type { PreviewNetworkMode } from "@deskcue/protocol";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import {
  hasApiErrorPayload,
  readApiErrorMessage
} from "@api/transport/httpClient";
import {
  acquirePendingCloudCommand,
  clearPendingCloudCommand,
  clearPendingCloudCommandForResult
} from "@api/transport/pendingCommandJournal";
import { isCurrentDeskCuePreviewPort } from "@models/sessionPreview";
import { getDeskCueRuntime } from "@runtime";

import { isCloudControlReceipt } from "./managedStopRecovery";
import {
  matchesPreview,
  recoverPreviewResult,
  recoverPreviewSession
} from "./previewCommandRecovery";
import {
  captureSessionSelectionOperation,
  isSessionSelectionOperationCurrent
} from "./selectionOperation";
import type { UseDashboardPreviewCommandHandlersArgs } from "./types";

export function useDashboardPreviewCommandHandlers({
  selectedSessionId,
  selectedSession,
  selectedSessionIdRef,
  selectedSessionSelectionEpochRef,
  previewPort,
  setSelectedSession,
  setError,
  loadOverview
}: UseDashboardPreviewCommandHandlersArgs) {
  const runtime = getDeskCueRuntime();
  const canRefreshGit = runtime.features.gitRefresh === true;
  const canManagePreview = runtime.features.previewControl === true;
  const handleRefreshGit = useCallback(async () => {
    if (!canRefreshGit || !selectedSessionId) return;
    const targetSessionId = selectedSessionId;
    const selectionOperation = captureSessionSelectionOperation(
      targetSessionId,
      selectedSessionSelectionEpochRef
    );
    const selectionIsCurrent = () => isSessionSelectionOperationCurrent(
      selectedSessionIdRef,
      selectedSessionSelectionEpochRef,
      selectionOperation
    );

    let result: Awaited<ReturnType<typeof sessionsApi.refreshGitWithMeta>>;
    try {
      result = await sessionsApi.refreshGitWithMeta(targetSessionId, {
        view: "diff"
      });
    } catch (error) {
      if (selectionIsCurrent()) setError(error instanceof Error ? error.message : "Failed to refresh git state");
      return;
    }

    if (!selectionIsCurrent()) return;

    setSelectedSession(result.data);
    if (result.notModified) return;

    await loadOverview();
  }, [
    canRefreshGit,
    loadOverview,
    selectedSessionId,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    setError,
    setSelectedSession
  ]);

  async function updatePreview(port: number | null, networkMode: PreviewNetworkMode) {
    if (!canManagePreview || !selectedSessionId) return false;
    const targetSessionId = selectedSessionId;
    const selectionOperation = captureSessionSelectionOperation(
      targetSessionId,
      selectedSessionSelectionEpochRef
    );
    const selectionIsCurrent = () => isSessionSelectionOperationCurrent(
      selectedSessionIdRef,
      selectedSessionSelectionEpochRef,
      selectionOperation
    );

    const requestedNetworkMode = networkMode;

    if (port !== null && Number.isNaN(port)) {
      setError("Preview port must be a number");
      return false;
    }

    if (isCurrentDeskCuePreviewPort(port, window.location)) {
      setError("Preview target cannot be the DeskCue web app. Choose the port of the app you want to review.");
      return false;
    }

    const command = acquirePendingCloudCommand(
      port === null ? "preview.stop" : "preview.configure",
      targetSessionId,
      `${requestedNetworkMode}:${port ?? "stopped"}`
    );
    let result: Awaited<ReturnType<typeof sessionsApi.setPreview>>;
    try {
      result = await sessionsApi.setPreview(
        targetSessionId,
        { networkMode: requestedNetworkMode, port },
        command.commandId
      );
    } catch (error) {
      const recovered = await recoverPreviewResult(targetSessionId, port, requestedNetworkMode);
      if (recovered) {
        clearPendingCloudCommand(command);
        if (selectionIsCurrent()) {
          setSelectedSession(recovered);
          await loadOverview();
        }
        return selectionIsCurrent();
      }
      if (selectionIsCurrent()) setError(error instanceof Error ? error.message : "Failed to set preview");
      return false;
    }
    const definitive = clearPendingCloudCommandForResult(command, result);
    if (!selectionIsCurrent()) return false;
    if (result.ok && isCloudControlReceipt(result.data, targetSessionId)) {
      const recovered = await recoverPreviewSession(targetSessionId);
      if (!recovered) {
        setError("Preview was updated, but its current state could not be loaded");
        return false;
      }
      setSelectedSession(recovered);
      await loadOverview();
      if (!matchesPreview(recovered, port, requestedNetworkMode)) {
        setError("Preview state changed after the command completed");
        return false;
      }
      return true;
    }
    if (!definitive) {
      const recovered = await recoverPreviewResult(
        targetSessionId,
        port,
        requestedNetworkMode
      );
      if (recovered) {
        clearPendingCloudCommand(command);
        setSelectedSession(recovered);
        await loadOverview();
        return true;
      }
    }
    if (!result.ok || hasApiErrorPayload(result.data)) {
      setError(readApiErrorMessage(result.data, "Failed to set preview"));
      return false;
    }

    setSelectedSession(result.data);
    await loadOverview();
    return true;
  }

  async function handleSetPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const port = previewPort.trim() ? Number(previewPort) : null;
    await updatePreview(port, selectedSession?.preview.networkMode ?? "device-direct");
  }

  function handleStopPreview() {
    return updatePreview(null, selectedSession?.preview.networkMode ?? "device-direct");
  }

  return {
    handleChangePreviewNetworkMode: (networkMode: PreviewNetworkMode) =>
      updatePreview(selectedSession?.preview.port ?? null, networkMode),
    handleRefreshGit,
    handleSetPreview,
    handleStopPreview
  };
}
