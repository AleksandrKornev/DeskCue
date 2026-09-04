import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import DownloadIcon from "@assets/images/icon-download.svg?react";
import ExternalLinkIcon from "@assets/images/icon-external-link.svg?react";
import {
  downloadLocalAsset,
  openLocalAssetInNewTab
} from "@modules/transcript/RichTranscriptContent/localAssetActions";

import styles from "./styles.module.scss";

type WorkspaceFileAction = "download" | "open";

type WorkspaceFileActionsProps = {
  fileName?: string;
  filePath: string;
  workspaceId: string;
};

type WorkspaceFileActionTarget = {
  name?: string;
  path: string;
};

function getWorkspaceFileActionName(file: WorkspaceFileActionTarget) {
  return file.name || file.path.split(/[\\/]/u).pop() || file.path;
}

async function performWorkspaceFileAction(
  action: WorkspaceFileAction,
  file: WorkspaceFileActionTarget,
  workspaceId: string,
  signal: AbortSignal
) {
  const context = { workspaceId };
  const fileName = getWorkspaceFileActionName(file);

  if (action === "open") {
    await openLocalAssetInNewTab(file.path, fileName, context, signal);
    return;
  }

  await downloadLocalAsset(file.path, fileName, context, signal);
}

export function WorkspaceFileActions({ fileName, filePath, workspaceId }: WorkspaceFileActionsProps) {
  const [pendingAction, setPendingAction] = useState<WorkspaceFileAction | null>(null);
  const activeRequestRef = useRef(0);
  const activeRequestControllerRef = useRef<AbortController | null>(null);

  const invalidatePendingAction = useCallback(() => {
    activeRequestRef.current += 1;
    activeRequestControllerRef.current?.abort();
    activeRequestControllerRef.current = null;
    setPendingAction(null);
  }, []);

  const runAction = useCallback((action: WorkspaceFileAction) => {
    if (activeRequestControllerRef.current) return;

    const controller = new AbortController();
    const requestId = activeRequestRef.current + 1;

    activeRequestRef.current = requestId;
    activeRequestControllerRef.current = controller;
    setPendingAction(action);

    const file = { name: fileName, path: filePath };

    void performWorkspaceFileAction(action, file, workspaceId, controller.signal)
      .catch((error) => {
        if (controller.signal.aborted || activeRequestRef.current !== requestId) return;

        toast.error(error instanceof Error
          ? error.message
          : `Unable to ${action} ${getWorkspaceFileActionName(file)}`);
      })
      .finally(() => {
        if (activeRequestRef.current !== requestId) return;

        activeRequestControllerRef.current = null;
        setPendingAction(null);
      });
  }, [fileName, filePath, workspaceId]);

  useEffect(() => invalidatePendingAction, [filePath, invalidatePendingAction, workspaceId]);

  const status = pendingAction === "open"
    ? "Opening file…"
    : pendingAction === "download" ? "Preparing download…" : "";
  const openLabel = pendingAction === "open" ? "Opening file" : "Open file";
  const downloadLabel = pendingAction === "download" ? "Preparing download" : "Download file";

  return (
    <>
      <div aria-label="File actions" className={styles.filePreviewActions} role="group">
        <button
          aria-label={openLabel}
          aria-disabled={pendingAction !== null}
          className={styles.fileActionDialogButton}
          onClick={() => runAction("open")}
          title="Open file"
          type="button"
        >
          <ExternalLinkIcon aria-hidden="true" focusable="false" />
        </button>
        <button
          aria-label={downloadLabel}
          aria-disabled={pendingAction !== null}
          className={styles.fileActionDialogPrimaryButton}
          onClick={() => runAction("download")}
          title="Download file"
          type="button"
        >
          <DownloadIcon aria-hidden="true" focusable="false" />
        </button>
      </div>
      <span aria-live="polite" className={styles.visuallyHidden} role="status">{status}</span>
    </>
  );
}
