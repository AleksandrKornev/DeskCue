import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";

import { ModalDialog } from "@components/ModalDialog";

import { runLocalAssetAction } from "./localAssetDialogActions";
import type { LocalAssetAction } from "./localAssetDialogActions";
import { LocalAssetDialogPreview } from "./LocalAssetDialogPreview";
import styles from "./styles.module.scss";
import type { LocalAssetActionDialogProps } from "./types";
import { useLocalAssetPreview } from "./useLocalAssetPreview";

type LocalAssetDialogControllerOptions = LocalAssetActionDialogProps;

function getLocalAssetFileName(assetPath: string) {
  return assetPath.split(/[\\/]/u).pop() || assetPath;
}

function getLocalAssetDialogIdentity({ assetContext, assetPath }: LocalAssetActionDialogProps) {
  return [
    assetPath,
    assetContext?.agentSessionId ?? "",
    assetContext?.managedSessionId ?? "",
    assetContext?.workspaceId ?? ""
  ].join("\u0000");
}

const LOCAL_ASSET_ERROR_COPY: Record<LocalAssetAction, { detail: string; title: string }> = {
  download: {
    detail: "Check that the file still exists, then try the download again.",
    title: "Download unavailable"
  },
  open: {
    detail: "Check that the file still exists, then try opening it again.",
    title: "File unavailable"
  }
};

function useLocalAssetDialogController({
  assetContext,
  assetPath,
  displayName,
  isOpen,
  onClose
}: LocalAssetDialogControllerOptions) {
  const [failedAction, setFailedAction] = useState<LocalAssetAction | null>(null);
  const [pendingAction, setPendingAction] = useState<LocalAssetAction | null>(null);
  const actionButtonRefs = useRef<Record<LocalAssetAction, HTMLButtonElement | null>>({
    download: null,
    open: null
  });
  const activeRequestRef = useRef(0);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const pendingActionRef = useRef<LocalAssetAction | null>(null);

  const invalidatePendingAction = useCallback(() => {
    activeRequestRef.current += 1;
    activeRequestControllerRef.current?.abort();
    activeRequestControllerRef.current = null;
    pendingActionRef.current = null;

    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
  }, []);

  const closeDialog = useCallback(() => {
    invalidatePendingAction();
    setFailedAction(null);
    setPendingAction(null);
    onClose();
  }, [invalidatePendingAction, onClose]);

  const runAction = useCallback(async (action: LocalAssetAction) => {
    if (pendingActionRef.current !== null) return;

    const actionButton = actionButtonRefs.current[action];
    const requestController = new AbortController();
    const requestId = activeRequestRef.current + 1;

    activeRequestRef.current = requestId;
    activeRequestControllerRef.current = requestController;
    pendingActionRef.current = action;
    setFailedAction(null);
    setPendingAction(action);

    try {
      await runLocalAssetAction(
        action,
        { assetContext, assetPath, displayName },
        requestController.signal
      );

      if (!mountedRef.current || activeRequestRef.current !== requestId) return;

      activeRequestControllerRef.current = null;
      closeDialog();
    } catch {
      if (!mountedRef.current || activeRequestRef.current !== requestId) return;

      activeRequestControllerRef.current = null;
      pendingActionRef.current = null;
      setPendingAction(null);
      setFailedAction(action);

      const activeElement = document.activeElement;
      const canReturnFocus = activeElement === actionButton || activeElement === document.body;

      if (!canReturnFocus) return;

      focusFrameRef.current = window.requestAnimationFrame(() => {
        focusFrameRef.current = null;

        if (!mountedRef.current || activeRequestRef.current !== requestId) return;
        if (document.activeElement !== actionButton && document.activeElement !== document.body) return;

        actionButtonRefs.current[action]?.focus({ preventScroll: true });
      });
    }
  }, [assetContext, assetPath, closeDialog, displayName]);

  useEffect(() => {
    if (isOpen) return;

    invalidatePendingAction();
  }, [invalidatePendingAction, isOpen]);

  useLayoutEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      invalidatePendingAction();
    };
  }, [invalidatePendingAction]);

  return {
    actionButtonRefs,
    closeDialog,
    failedAction,
    pendingAction,
    runAction
  };
}

function LocalAssetActionDialogContent({
  assetContext,
  assetPath,
  displayName,
  isOpen,
  onRetryPreview,
  previewImage,
  previewStatus,
  onClose
}: LocalAssetActionDialogProps) {
  const fileName = getLocalAssetFileName(assetPath);
  const {
    actionButtonRefs,
    closeDialog,
    failedAction,
    pendingAction,
    runAction
  } = useLocalAssetDialogController({
    assetContext,
    assetPath,
    displayName: fileName,
    isOpen,
    onClose
  });
  const { markPreviewFailed, preview, retryPreview } = useLocalAssetPreview({
    assetContext,
    assetPath,
    displayName: fileName,
    isOpen,
    previewImage,
    previewStatus
  });
  const canRetryPreview = preview.failure === "load" || (
    preview.failure === "decode" &&
    preview.kind === "image" &&
    (!previewStatus || Boolean(onRetryPreview))
  );

  const handleRetryPreview = useCallback(() => {
    if (preview.kind === "image" && previewStatus === "error" && onRetryPreview) {
      onRetryPreview();
      return;
    }

    retryPreview();
  }, [onRetryPreview, preview.kind, previewStatus, retryPreview]);
  const errorCopy = failedAction ? LOCAL_ASSET_ERROR_COPY[failedAction] : null;
  const usesCompactPreview = preview.kind === "audio" ||
    preview.status === "error" ||
    preview.status === "unsupported" ||
    (preview.kind === "text" && preview.status === "ready" && !preview.text);

  return (
    <ModalDialog
      actionsLayout="equal"
      bodyClassName={styles.localAssetDialogBody}
      className={clsx(
        styles.localAssetDialog,
        usesCompactPreview && styles.localAssetDialogCompact
      )}
      actions={(
        <>
          <div
            className={styles.localAssetDialogFeedback}
          >
            {pendingAction ? (
              <p aria-live="polite" role="status">
                {pendingAction === "open" ? "Opening local file…" : "Preparing download…"}
              </p>
            ) : null}
            {errorCopy ? (
              <div aria-label={errorCopy.title} className={styles.localAssetDialogError} role="alert">
                <strong>{errorCopy.title}</strong>
                <span>{errorCopy.detail}</span>
              </div>
            ) : null}
          </div>
          <button
            aria-disabled={pendingAction !== null}
            className={styles.localAssetDialogAction}
            ref={(element) => {
              actionButtonRefs.current.open = element;
            }}
            onClick={() => void runAction("open")}
            type="button"
          >
            {pendingAction === "open"
              ? "Opening…"
              : failedAction === "open" ? "Try open again" : "Open"}
          </button>
          <button
            aria-disabled={pendingAction !== null}
            className={styles.localAssetDialogActionPrimary}
            ref={(element) => {
              actionButtonRefs.current.download = element;
            }}
            onClick={() => void runAction("download")}
            type="button"
          >
            {pendingAction === "download"
              ? "Downloading…"
              : failedAction === "download" ? "Try download again" : "Download"}
          </button>
        </>
      )}
      description={(
        <span className={styles.localAssetDialogPath} title={assetPath}>
          {assetPath}
        </span>
      )}
      isOpen={isOpen}
      size="default"
      title={fileName}
      titleClassName={styles.localAssetDialogTitle}
      onClose={closeDialog}
    >
      <LocalAssetDialogPreview
        alt={previewImage?.alt ?? displayName}
        canRetry={canRetryPreview}
        displayName={fileName}
        preview={preview}
        onPreviewError={markPreviewFailed}
        onRetry={handleRetryPreview}
      />
    </ModalDialog>
  );
}

export function LocalAssetActionDialog(props: LocalAssetActionDialogProps) {
  return <LocalAssetActionDialogContent key={getLocalAssetDialogIdentity(props)} {...props} />;
}
