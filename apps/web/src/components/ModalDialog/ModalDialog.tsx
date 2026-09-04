import clsx from "clsx";

import { Modal } from "@components/Modal";

import styles from "./styles.module.scss";
import type { ModalDialogProps } from "./types";

export function ModalDialog({
  actions,
  actionsLayout = "weighted",
  size = "confirm",
  ...modalProps
}: ModalDialogProps) {
  return (
    <Modal
      {...modalProps}
      size={size}
      footer={actions ? (
        <div className={clsx(
          styles.actions,
          actionsLayout === "equal" && styles.actionsEqual
        )}>
          {actions}
        </div>
      ) : null}
    />
  );
}
