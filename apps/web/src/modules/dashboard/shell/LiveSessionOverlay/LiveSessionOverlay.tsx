import type { ReactNode } from "react";

import CloseIcon from "@assets/images/icon-close.svg?react";
import { useBottomSheetDrag } from "@components/BottomSheet";
import { useModalFocusLifecycle } from "@components/Modal";

import styles from "./styles.module.scss";

export type LiveSessionOverlayProps = {
  toolsContent: ReactNode;
  onClose: () => void;
};

export function LiveSessionOverlay({
  toolsContent,
  onClose
}: LiveSessionOverlayProps) {
  const {
    dragHandleProps,
    sheetGestureProps,
    sheetRef
  } = useBottomSheetDrag<HTMLDivElement>({ onDismiss: onClose });

  useModalFocusLifecycle({ dialogRef: sheetRef, onClose });

  return (
    <div className={styles.overlay}>
      <button
        aria-hidden="true"
        aria-label="Close overlay"
        className={styles.backdrop}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-label="Tools and diagnostics"
        aria-modal="true"
        className={styles.panel}
        ref={sheetRef}
        role="dialog"
        tabIndex={-1}
        {...sheetGestureProps}
      >
        <div aria-hidden="true" className={styles.dragHandle} {...dragHandleProps} />
        <div className={styles.shell}>
          <div className={styles.header} {...dragHandleProps}>
            <div className={styles.headerCopy}>
              <strong>Tools and diagnostics</strong>
              <p>Secondary controls and local diagnostics stay here, outside the main chat flow</p>
            </div>
            <div className={styles.headerActions}>
              <button
                aria-label="Close overlay"
                className={styles.close}
                onClick={onClose}
                type="button"
              >
                <CloseIcon className={styles.closeIcon} aria-hidden="true" focusable="false" />
              </button>
            </div>
          </div>

          <div className={styles.content}>
            <div className={styles.toolsStack}>{toolsContent}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
