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
import styles from "./styles.module.scss";
import type { LocalAssetActionDialogProps } from "./types";

type LocalAssetDialogControllerOptions = LocalAssetActionDialogProps;

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

export function LocalAssetActionDialog({
  assetContext,
  assetPath,
  displayName,
  isOpen,
  onClose
}: LocalAssetActionDialogProps) {
  const {
    actionButtonRefs,
    closeDialog,
    failedAction,
    pendingAction,
    runAction
  } = useLocalAssetDialogController({
    assetContext,
    assetPath,
    displayName,
    isOpen,
    onClose
  });
  const errorCopy = failedAction ? LOCAL_ASSET_ERROR_COPY[failedAction] : null;

  return (
    <ModalDialog
      className={styles.localAssetDialog}
      actions={(
        <>
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
      description={<span className={styles.localAssetDialogPath}>{assetPath}</span>}
      isOpen={isOpen}
      title={displayName}
      onClose={closeDialog}
    >
      <div aria-busy={pendingAction !== null} className={styles.localAssetDialogFeedback}>
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
    </ModalDialog>
  );
}
