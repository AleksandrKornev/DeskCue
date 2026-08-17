import { Modal } from "@components/Modal";

import styles from "./styles.module.scss";
import type { ModalDialogProps } from "./types";

export function ModalDialog({
  actions,
  size = "confirm",
  ...modalProps
}: ModalDialogProps) {
  return (
    <Modal
      {...modalProps}
      size={size}
      footer={actions ? <div className={styles.actions}>{actions}</div> : null}
    />
  );
}
