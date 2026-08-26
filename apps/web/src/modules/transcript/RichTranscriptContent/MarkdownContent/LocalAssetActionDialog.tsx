import { useState } from "react";

import { ModalDialog } from "@components/ModalDialog";

import { runLocalAssetAction } from "./localAssetDialogActions";
import type { LocalAssetAction } from "./localAssetDialogActions";
import styles from "./styles.module.scss";
import type { LocalAssetActionDialogProps } from "./types";

export function LocalAssetActionDialog({
  assetContext,
  assetPath,
  displayName,
  isOpen,
  onClose
}: LocalAssetActionDialogProps) {
  const [pendingAction, setPendingAction] = useState<LocalAssetAction | null>(null);
  const actionProps = { assetContext, assetPath, displayName, onClose };

  return (
    <ModalDialog
      className={styles.localAssetDialog}
      actions={(
        <>
          <button
            className={styles.localAssetDialogAction}
            disabled={pendingAction !== null}
            onClick={() => void runLocalAssetAction("open", actionProps, setPendingAction)}
            type="button"
          >
            {pendingAction === "open" ? "Opening..." : "Open"}
          </button>
          <button
            className={styles.localAssetDialogActionPrimary}
            disabled={pendingAction !== null}
            onClick={() => void runLocalAssetAction("download", actionProps, setPendingAction)}
            type="button"
          >
            {pendingAction === "download" ? "Downloading..." : "Download"}
          </button>
        </>
      )}
      description={<span className={styles.localAssetDialogPath}>{assetPath}</span>}
      isOpen={isOpen}
      title={displayName}
      onClose={onClose}
    />
  );
}
