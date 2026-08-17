import clsx from "clsx";

import { ModalDialog } from "./ModalDialog";
import styles from "./styles.module.scss";
import type { ConfirmDialogProps } from "./types";

export function ConfirmDialog({
  cancelLabel = "Cancel",
  confirmLabel,
  confirmingLabel = "Working...",
  description,
  isConfirming = false,
  isOpen,
  title,
  tone = "default",
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  return (
    <ModalDialog
      closeLabel="Cancel confirmation"
      description={description}
      isOpen={isOpen}
      title={title}
      onClose={onCancel}
      actions={(
        <>
          <button
            className={styles.cancelButton}
            disabled={isConfirming}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={clsx(
              styles.confirmButton,
              tone === "danger" && styles.confirmButtonDanger
            )}
            disabled={isConfirming}
            onClick={onConfirm}
            type="button"
          >
            {isConfirming ? confirmingLabel : confirmLabel}
          </button>
        </>
      )}
    />
  );
}
