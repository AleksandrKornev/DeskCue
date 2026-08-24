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
  createModalKeyDownHandler,
  createModalPopStateHandler,
  readHistoryState
} from "./helpers";
import styles from "./styles.module.scss";
import type { ModalProps } from "./types";

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
  size = "default",
  title,
  titleId,
  onClose
}: ModalProps) {
  const generatedTitleId = useId();
  const generatedDescriptionId = useId();
  const onCloseRef = useRef(onClose);
  const historyEntryActiveRef = useRef(false);
  const resolvedTitleId = titleId ?? generatedTitleId;
  const {
    dragHandleProps,
    sheetGestureProps,
    sheetRef: dialogRef
  } = useBottomSheetDrag<HTMLDivElement>({ onDismiss: onClose });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";

    window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = createModalKeyDownHandler(dialogRef, onCloseRef);

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedElement?.focus({ preventScroll: true });
    };
  }, [dialogRef, isOpen]);

  useEffect(() => {
    if (!isOpen || !closeOnHistoryBack) return;

    const marker = `${generatedTitleId}-history`;

    if (readHistoryState().deskCueModal !== marker) {
      window.history.pushState({ ...readHistoryState(), deskCueModal: marker }, "");
    }

    historyEntryActiveRef.current = true;

    const handlePopState = createModalPopStateHandler(historyEntryActiveRef, onCloseRef);

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
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
            window.history.back();
          }
        });
      }
    };
  }, [closeOnHistoryBack, generatedTitleId, isOpen]);

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
        className={clsx(styles.dialog, size === "confirm" && styles.dialogConfirm, className)}
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
