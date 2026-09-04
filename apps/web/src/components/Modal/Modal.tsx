import clsx from "clsx";
import {
  useId
} from "react";
import { createPortal } from "react-dom";

import { useBottomSheetDrag } from "@components/BottomSheet";

import { ModalCloseButton } from "./ModalCloseButton";
import styles from "./styles.module.scss";
import type { ModalProps } from "./types";
import { useModalFocusLifecycle } from "./useModalFocusLifecycle";
import { useModalHistoryLifecycle } from "./useModalHistoryLifecycle";

export function Modal({
  bodyClassName,
  children,
  className,
  closeLabel = "Close dialog",
  closeOnHistoryBack = false,
  description,
  eyebrow,
  footer,
  isOpen,
  restoreFocusOnClose = true,
  size = "default",
  title,
  titleClassName,
  titleId,
  onClose
}: ModalProps) {
  const generatedTitleId = useId();
  const generatedDescriptionId = useId();
  const resolvedTitleId = titleId ?? generatedTitleId;
  const {
    dragHandleProps,
    sheetGestureProps,
    sheetRef: dialogRef
  } = useBottomSheetDrag<HTMLDivElement>({ onDismiss: onClose });
  const { modalEntryId, onCloseRef } = useModalFocusLifecycle({
    dialogRef,
    isOpen,
    restoreFocusOnClose,
    onClose
  });

  useModalHistoryLifecycle({
    enabled: closeOnHistoryBack,
    historyId: generatedTitleId,
    isOpen,
    modalEntryId,
    onCloseRef
  });

  if (!isOpen) return null;

  return createPortal(
    <div className={styles.layer}>
      <div
        aria-hidden="true"
        className={styles.backdrop}
        onClick={onClose}
      />
      <div
        aria-describedby={description ? generatedDescriptionId : undefined}
        aria-labelledby={resolvedTitleId}
        aria-modal="true"
        className={clsx(
          styles.dialog,
          size === "confirm" && styles.dialogConfirm,
          !footer && styles.dialogWithoutFooter,
          className
        )}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        {...sheetGestureProps}
      >
        <div aria-hidden="true" className={styles.dragHandle} {...dragHandleProps} />
        <div className={styles.header} {...dragHandleProps}>
          <div>
            {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
            <h2 className={titleClassName} id={resolvedTitleId}>{title}</h2>
            {description ? <p id={generatedDescriptionId}>{description}</p> : null}
          </div>
          <ModalCloseButton label={closeLabel} onClick={onClose} />
        </div>
        {children ? <div className={clsx(styles.body, bodyClassName)}>{children}</div> : null}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
