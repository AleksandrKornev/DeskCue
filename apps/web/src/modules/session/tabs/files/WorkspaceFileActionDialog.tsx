import { useState } from "react";
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
  setPendingAction: (action: WorkspaceFileAction | null) => void
) {
  setPendingAction(action);

  try {
    const context = { workspaceId };

    if (action === "open") {
      await openLocalAssetInNewTab(file.path, file.name, context);
    } else {
      await downloadLocalAsset(file.path, file.name, context);
    }

    onClose();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : `Unable to ${action} ${file.name}`);
  } finally {
    setPendingAction(null);
  }
}

export function WorkspaceFileActionDialog({
  file,
  workspaceId,
  onClose,
  onPreview
}: WorkspaceFileActionDialogProps) {
  const [pendingAction, setPendingAction] = useState<WorkspaceFileAction | null>(null);

  return (
    <Modal
      footer={file ? (
        <div className={styles.fileActionDialogActions}>
          <button
            className={styles.fileActionDialogButton}
            disabled={pendingAction !== null}
            onClick={() => onPreview(file)}
            type="button"
          >Preview</button>
          <button
            className={styles.fileActionDialogButton}
            disabled={pendingAction !== null}
            onClick={() => void runWorkspaceFileAction(
              "open",
              file,
              workspaceId,
              onClose,
              setPendingAction
            )}
            type="button"
          >{pendingAction === "open" ? "Opening…" : "Open"}</button>
          <button
            className={styles.fileActionDialogPrimaryButton}
            disabled={pendingAction !== null}
            onClick={() => void runWorkspaceFileAction(
              "download",
              file,
              workspaceId,
              onClose,
              setPendingAction
            )}
            type="button"
          >{pendingAction === "download" ? "Downloading…" : "Download"}</button>
        </div>
      ) : null}
      description={file ? (
        <span className={styles.fileActionDialogPath}>{file.path}</span>
      ) : null}
      isOpen={file !== null}
      size="confirm"
      title={file?.name ?? "Workspace file"}
      onClose={onClose}
    />
  );
}
