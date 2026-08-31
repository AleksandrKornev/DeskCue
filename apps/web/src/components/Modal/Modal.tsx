import clsx from "clsx";
import {
  useEffect,
  useId,
  useRef
} from "react";
import { createPortal } from "react-dom";

import CloseIcon from "@assets/images/icon-close.svg?react";
import { useBottomSheetDrag } from "@components/BottomSheet";

import {
  createModalHistoryMarker,
  createModalPopStateHandler,
  readHistoryState,
  registerModalHistoryMarker,
  requestInactiveModalHistoryCleanup,
  unregisterModalHistoryMarker
} from "./helpers";
import styles from "./styles.module.scss";
import type { ModalProps } from "./types";
import {
  isModalEntryTop,
  useModalFocusLifecycle
} from "./useModalFocusLifecycle";

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
  titleId,
  onClose
}: ModalProps) {
  const generatedTitleId = useId();
  const generatedDescriptionId = useId();
  const historyEntryActiveRef = useRef(false);
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

  useEffect(() => {
    if (!isOpen || !closeOnHistoryBack) return;

    const marker = createModalHistoryMarker(generatedTitleId);

    if (readHistoryState().deskCueModal !== marker) {
      window.history.pushState({ ...readHistoryState(), deskCueModal: marker }, "");
    }

    registerModalHistoryMarker(marker);
    historyEntryActiveRef.current = true;

    const handlePopState = createModalPopStateHandler(
      historyEntryActiveRef,
      onCloseRef,
      marker,
      () => isModalEntryTop(modalEntryId)
    );

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      unregisterModalHistoryMarker(marker);
      if (
        historyEntryActiveRef.current &&
        readHistoryState().deskCueModal === marker
      ) {
        historyEntryActiveRef.current = false;
        queueMicrotask(() => {
          if (
            !historyEntryActiveRef.current &&
            readHistoryState().deskCueModal === marker
          ) {
            requestInactiveModalHistoryCleanup();
          }
        });
      }
    };
  }, [closeOnHistoryBack, generatedTitleId, isOpen, modalEntryId, onCloseRef]);

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
            <h2 id={resolvedTitleId}>{title}</h2>
            {description ? <p id={generatedDescriptionId}>{description}</p> : null}
          </div>
          <button
            aria-label={closeLabel}
            className={styles.close}
            onClick={onClose}
            type="button"
          >
            <CloseIcon className={styles.closeIcon} aria-hidden="true" focusable="false" />
          </button>
        </div>
        {children ? <div className={clsx(styles.body, bodyClassName)}>{children}</div> : null}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
