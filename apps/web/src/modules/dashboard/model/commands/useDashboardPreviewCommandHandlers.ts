import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, SubmitEvent } from "react";

import type { PreviewNetworkMode } from "@deskcue/protocol";
import {
  isConnectionEpochCurrent,
  readConnectionEpoch
} from "@api/connection/events";
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
import {
  isCurrentDeskCuePreviewPort,
  parsePreviewPort
} from "@models/sessionPreview";
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
import type { SessionSelectionOperation } from "./selectionOperation";
import type { UseDashboardPreviewCommandHandlersArgs } from "./types";

type SelectionContext = Pick<
  UseDashboardPreviewCommandHandlersArgs,
  "selectedSessionIdRef" | "selectedSessionSelectionEpochRef"
>;

type RefreshGitArgs = SelectionContext & Pick<
  UseDashboardPreviewCommandHandlersArgs,
  "loadOverview" | "selectedSessionId" | "setError" | "setSelectedSession"
> & {
  canRefreshGit: boolean;
};

type UpdatePreviewArgs = SelectionContext & Pick<
  UseDashboardPreviewCommandHandlersArgs,
  "loadOverview" | "selectedSessionId" | "setSelectedSession"
> & {
  canManagePreview: boolean;
  connectionEpoch: number;
  intentEpoch: number;
  networkMode: PreviewNetworkMode;
  port: number | null;
  previewIntentEpochRef: MutableRefObject<number>;
  selectionOperation: SessionSelectionOperation;
  setPreviewError: (value: string) => void;
};

type QueuedPreviewUpdateArgs = Omit<
  UpdatePreviewArgs,
  "connectionEpoch" | "intentEpoch" | "selectionOperation"
>;
type PreviewMutationRequest = {
  args: QueuedPreviewUpdateArgs;
  connectionEpoch: number;
  intentEpoch: number;
  reject: (reason?: unknown) => void;
  resolve: (value: boolean) => void;
  selectionOperation: SessionSelectionOperation;
};

type PreviewMutationQueue = {
  active: PreviewMutationRequest | null;
  pending: PreviewMutationRequest | null;
};

type PreviewMutationQueueRef = MutableRefObject<PreviewMutationQueue>;

function isSelectionCurrent(
  context: SelectionContext,
  operation: SessionSelectionOperation,
  connectionEpoch: number
) {
  return isConnectionEpochCurrent(connectionEpoch) && isSessionSelectionOperationCurrent(
    context.selectedSessionIdRef,
    context.selectedSessionSelectionEpochRef,
    operation
  );
}

function isPreviewMutationCurrent(
  context: SelectionContext,
  operation: SessionSelectionOperation,
  connectionEpoch: number,
  previewIntentEpochRef: MutableRefObject<number>,
  intentEpoch: number
) {
  return previewIntentEpochRef.current === intentEpoch &&
    isSelectionCurrent(context, operation, connectionEpoch);
}

function isPreviewUpdateCurrent(context: SelectionContext, args: UpdatePreviewArgs) {
  return isPreviewMutationCurrent(
    context,
    args.selectionOperation,
    args.connectionEpoch,
    args.previewIntentEpochRef,
    args.intentEpoch
  );
}

async function refreshGit({
  canRefreshGit,
  loadOverview,
  selectedSessionId,
  selectedSessionIdRef,
  selectedSessionSelectionEpochRef,
  setError,
  setSelectedSession
}: RefreshGitArgs) {
  if (!canRefreshGit || !selectedSessionId) return;

  const selectionContext = {
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef
  };

  const targetSessionId = selectedSessionId;
  const selectionOperation = captureSessionSelectionOperation(
    targetSessionId,
    selectedSessionSelectionEpochRef
  );
  const connectionEpoch = readConnectionEpoch();

  let result: Awaited<ReturnType<typeof sessionsApi.refreshGitWithMeta>>;

  try {
    result = await sessionsApi.refreshGitWithMeta(targetSessionId, {
      view: "diff"
    });
  } catch (error) {
    if (isSelectionCurrent(selectionContext, selectionOperation, connectionEpoch)) {
      setError(error instanceof Error ? error.message : "Failed to refresh git state");
    }

    return;
  }

  if (!isSelectionCurrent(selectionContext, selectionOperation, connectionEpoch)) return;

  setSelectedSession(result.data);
  if (result.notModified) return;

  await loadOverview();
}

async function updatePreview(args: UpdatePreviewArgs) {
  const {
    canManagePreview,
    loadOverview,
    networkMode,
    port,
    selectedSessionId,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    setPreviewError,
    setSelectedSession
  } = args;

  if (!canManagePreview || !selectedSessionId) return false;

  const selectionContext = {
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef
  };

  if (!isPreviewUpdateCurrent(selectionContext, args)) return false;

  const targetSessionId = selectedSessionId;

  if (port !== null && (!Number.isSafeInteger(port) || port < 1 || port > 65_535)) {
    setPreviewError("Preview port must be an integer between 1 and 65535");
    return false;
  }

  if (isCurrentDeskCuePreviewPort(port, window.location)) {
    setPreviewError("Preview target cannot be the DeskCue web app. Choose the port of the app you want to review.");
    return false;
  }

  setPreviewError("");

  const command = acquirePendingCloudCommand(
    port === null ? "preview.stop" : "preview.configure",
    targetSessionId,
    `${networkMode}:${port ?? "stopped"}`
  );
  let result: Awaited<ReturnType<typeof sessionsApi.setPreview>>;

  try {
    result = await sessionsApi.setPreview(
      targetSessionId,
      { networkMode, port },
      command.commandId
    );
  } catch (error) {
    if (!isPreviewUpdateCurrent(selectionContext, args)) return false;

    const recovered = await recoverPreviewResult(targetSessionId, port, networkMode);

    if (recovered) {
      clearPendingCloudCommand(command);
      if (isPreviewUpdateCurrent(selectionContext, args)) {
        setSelectedSession(recovered);
        await loadOverview();
      }

      return isPreviewUpdateCurrent(selectionContext, args);
    }

    if (isPreviewUpdateCurrent(selectionContext, args)) {
      setPreviewError(error instanceof Error ? error.message : "Failed to set preview");
    }

    return false;
  }

  const definitive = clearPendingCloudCommandForResult(command, result);

  if (!isPreviewUpdateCurrent(selectionContext, args)) return false;

  if (result.ok && isCloudControlReceipt(result.data, targetSessionId)) {
    const recovered = await recoverPreviewSession(targetSessionId);

    if (!isPreviewUpdateCurrent(selectionContext, args)) return false;

    if (!recovered) {
      setPreviewError("Preview was updated, but its current state could not be loaded");
      return false;
    }

    setSelectedSession(recovered);
    await loadOverview();

    if (!isPreviewUpdateCurrent(selectionContext, args)) return false;

    if (!matchesPreview(recovered, port, networkMode)) {
      setPreviewError("Preview state changed after the command completed");
      return false;
    }

    return true;
  }

  if (!definitive) {
    const recovered = await recoverPreviewResult(targetSessionId, port, networkMode);

    if (!isPreviewUpdateCurrent(selectionContext, args)) return false;

    if (recovered) {
      clearPendingCloudCommand(command);
      setSelectedSession(recovered);
      await loadOverview();
      return true;
    }
  }

  if (!result.ok || hasApiErrorPayload(result.data)) {
    setPreviewError(readApiErrorMessage(result.data, "Failed to set preview"));
    return false;
  }

  setSelectedSession(result.data);
  await loadOverview();
  return true;
}

async function runPreviewMutationQueue(queueRef: PreviewMutationQueueRef) {
  while (queueRef.current.active) {
    const request = queueRef.current.active;

    try {
      request.resolve(await updatePreview({
        ...request.args,
        connectionEpoch: request.connectionEpoch,
        intentEpoch: request.intentEpoch,
        selectionOperation: request.selectionOperation
      }));
    } catch (error) {
      request.reject(error);
    }

    queueRef.current.active = queueRef.current.pending;
    queueRef.current.pending = null;
  }
}

function queuePreviewUpdate(
  queueRef: PreviewMutationQueueRef,
  args: QueuedPreviewUpdateArgs
) {
  if (!args.canManagePreview || !args.selectedSessionId) return Promise.resolve(false);

  const selectionOperation = captureSessionSelectionOperation(
    args.selectedSessionId,
    args.selectedSessionSelectionEpochRef
  );
  const connectionEpoch = readConnectionEpoch();
  const intentEpoch = ++args.previewIntentEpochRef.current;

  return new Promise<boolean>((resolve, reject) => {
    const request = { args, connectionEpoch, intentEpoch, reject, resolve, selectionOperation };

    if (!queueRef.current.active) {
      queueRef.current.active = request;
      void runPreviewMutationQueue(queueRef);
      return;
    }

    queueRef.current.pending?.resolve(false);
    queueRef.current.pending = request;
  });
}

export function useDashboardPreviewCommandHandlers({
  selectedSessionId,
  selectedSession,
  selectedSessionIdRef,
  selectedSessionSelectionEpochRef,
  previewPort,
  setPreviewPort,
  setSelectedSession,
  setError,
  loadOverview
}: UseDashboardPreviewCommandHandlersArgs) {
  const runtime = getDeskCueRuntime();
  const canRefreshGit = runtime.features.gitRefresh === true;
  const canManagePreview = runtime.features.previewControl === true;
  const [previewError, setPreviewError] = useState("");
  const previewIntentEpochRef = useRef(0);
  const previewMutationQueueRef = useRef<PreviewMutationQueue>({
    active: null,
    pending: null
  });

  useEffect(() => {
    previewIntentEpochRef.current += 1;
    setPreviewError("");
  }, [selectedSessionId]);

  const handleChangePreviewPort = useCallback((value: string) => {
    previewIntentEpochRef.current += 1;
    setPreviewError("");
    setPreviewPort(value);
  }, [setPreviewPort]);

  const handleRefreshGit = useCallback(() => refreshGit({
    canRefreshGit,
    loadOverview,
    selectedSessionId,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    setError,
    setSelectedSession
  }), [
    canRefreshGit,
    loadOverview,
    selectedSessionId,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    setError,
    setSelectedSession
  ]);

  return {
    handleChangePreviewNetworkMode: (networkMode: PreviewNetworkMode) => {
      const parsedPort = parsePreviewPort(
        previewPort,
        selectedSession?.preview.port ?? null
      );

      if (!parsedPort.ok) return Promise.resolve(false);

      return queuePreviewUpdate(previewMutationQueueRef, {
        canManagePreview,
        loadOverview,
        networkMode,
        port: parsedPort.port,
        previewIntentEpochRef,
        selectedSessionId,
        selectedSessionIdRef,
        selectedSessionSelectionEpochRef,
        setPreviewError,
        setSelectedSession
      });
    },
    handleRefreshGit,
    handleChangePreviewPort,
    previewError,
    handleSetPreview: async (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();

      const parsedPort = parsePreviewPort(previewPort);

      if (!parsedPort.ok) return;

      await queuePreviewUpdate(previewMutationQueueRef, {
        canManagePreview,
        loadOverview,
        networkMode: selectedSession?.preview.networkMode ?? "device-direct",
        port: parsedPort.port,
        previewIntentEpochRef,
        selectedSessionId,
        selectedSessionIdRef,
        selectedSessionSelectionEpochRef,
        setPreviewError,
        setSelectedSession
      });
    },
    handleStopPreview: () => queuePreviewUpdate(previewMutationQueueRef, {
      canManagePreview,
      loadOverview,
      networkMode: selectedSession?.preview.networkMode ?? "device-direct",
      port: null,
      previewIntentEpochRef,
      selectedSessionId,
      selectedSessionIdRef,
      selectedSessionSelectionEpochRef,
      setPreviewError,
      setSelectedSession
    })
  };
}
