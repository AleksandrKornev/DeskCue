import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { WorkspaceFileEntry } from "@deskcue/protocol";
import { Modal } from "@components/Modal";
import {
  downloadLocalAsset,
  openLocalAssetInNewTab
} from "@modules/transcript/RichTranscriptContent/localAssetActions";

import styles from "./styles.module.scss";

type WorkspaceFileAction = "download" | "open";

type WorkspaceFileActionDialogProps = {
  file: WorkspaceFileEntry | null;
  workspaceId: string;
  onClose: () => void;
  onPreview: (file: WorkspaceFileEntry) => void;
};

async function runWorkspaceFileAction(
  action: WorkspaceFileAction,
  file: WorkspaceFileEntry,
  workspaceId: string,
  onClose: () => void,
  setPendingAction: (action: WorkspaceFileAction | null) => void,
  signal: AbortSignal,
  isCurrent: () => boolean
) {
  setPendingAction(action);

  try {
    const context = { workspaceId };

    if (action === "open") {
      await openLocalAssetInNewTab(file.path, file.name, context, signal);
    } else {
      await downloadLocalAsset(file.path, file.name, context, signal);
    }

    if (!isCurrent()) return;

    onClose();
  } catch (error) {
    if (!isCurrent()) return;

    toast.error(error instanceof Error ? error.message : `Unable to ${action} ${file.name}`);
  } finally {
    if (isCurrent()) setPendingAction(null);
  }
}

export function WorkspaceFileActionDialog({
  file,
  workspaceId,
  onClose,
  onPreview
}: WorkspaceFileActionDialogProps) {
  const [pendingAction, setPendingAction] = useState<WorkspaceFileAction | null>(null);
  const [previewTarget, setPreviewTarget] = useState<WorkspaceFileEntry | null>(null);
  const activeRequestRef = useRef(0);
  const activeRequestControllerRef = useRef<AbortController | null>(null);

  const invalidatePendingAction = useCallback(() => {
    activeRequestRef.current += 1;
    activeRequestControllerRef.current?.abort();
    activeRequestControllerRef.current = null;
  }, []);

  const closeDialog = useCallback(() => {
    invalidatePendingAction();
    setPendingAction(null);
    onClose();
  }, [invalidatePendingAction, onClose]);

  const runAction = useCallback((action: WorkspaceFileAction) => {
    if (!file || activeRequestControllerRef.current) return;

    const controller = new AbortController();
    const requestId = activeRequestRef.current + 1;

    activeRequestRef.current = requestId;
    activeRequestControllerRef.current = controller;
    void runWorkspaceFileAction(
      action,
      file,
      workspaceId,
      closeDialog,
      setPendingAction,
      controller.signal,
      () => !controller.signal.aborted && activeRequestRef.current === requestId
    ).finally(() => {
      if (activeRequestRef.current === requestId) {
        activeRequestControllerRef.current = null;
      }
    });
  }, [closeDialog, file, workspaceId]);

  useEffect(() => {
    setPendingAction(null);

    return invalidatePendingAction;
  }, [file?.path, invalidatePendingAction, workspaceId]);

  useEffect(() => {
    if (!previewTarget) return;

    const target = previewTarget;

    setPreviewTarget(null);
    onPreview(target);
  }, [onPreview, previewTarget]);

  return (
    <Modal
      footer={file ? (
        <div className={styles.fileActionDialogActions}>
          <button
            className={styles.fileActionDialogButton}
            disabled={pendingAction !== null}
            onClick={() => setPreviewTarget(file)}
            type="button"
          >Preview</button>
          <button
            className={styles.fileActionDialogButton}
            disabled={pendingAction !== null}
            onClick={() => runAction("open")}
            type="button"
          >{pendingAction === "open" ? "Opening…" : "Open"}</button>
          <button
            className={styles.fileActionDialogPrimaryButton}
            disabled={pendingAction !== null}
            onClick={() => runAction("download")}
            type="button"
          >{pendingAction === "download" ? "Downloading…" : "Download"}</button>
        </div>
      ) : null}
      description={file && file.path !== file.name ? (
        <span className={styles.fileActionDialogPath}>{file.path}</span>
      ) : null}
      isOpen={file !== null}
      restoreFocusOnClose={previewTarget === null}
      size="confirm"
      title={file?.name ?? "Workspace file"}
      onClose={closeDialog}
    />
  );
}
