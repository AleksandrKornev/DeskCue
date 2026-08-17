import clsx from "clsx";
import {
  useEffect,
  useId,
  useRef
} from "react";
import { createPortal } from "react-dom";

import CloseIcon from "@assets/images/icon-close.svg?react";
import { useBottomSheetDrag } from "@components/BottomSheet";

import { getFocusableElements } from "./helpers";
import styles from "./styles.module.scss";
import type { ModalProps } from "./types";

export function Modal({
  bodyClassName,
  children,
  className,
  closeLabel = "Close dialog",
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
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previouslyFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = getFocusableElements(dialogRef.current);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      const activeElement = document.activeElement;
      const focusIsInsideDialog = activeElement instanceof Node &&
        dialogRef.current.contains(activeElement);
      if (
        event.shiftKey &&
        (activeElement === firstElement || activeElement === dialogRef.current || !focusIsInsideDialog)
      ) {
        event.preventDefault();
        lastElement?.focus();
      } else if (!event.shiftKey && (activeElement === lastElement || !focusIsInsideDialog)) {
        event.preventDefault();
        firstElement?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedElement?.focus({ preventScroll: true });
    };
  }, [dialogRef, isOpen]);

  if (!isOpen) {
    return null;
  }

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
