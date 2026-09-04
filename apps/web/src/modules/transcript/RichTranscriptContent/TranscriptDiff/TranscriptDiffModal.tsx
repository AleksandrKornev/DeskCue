import clsx from "clsx";
import { createPortal } from "react-dom";

import { useBottomSheetDrag } from "@components/BottomSheet";
import { ModalCloseButton, useModalFocusLifecycle } from "@components/Modal";
import {
  getDiffLineMarker,
  getDiffLineTone,
  getDiffStatusLabel,
  getDiffStatusLetter,
  splitDiffLines
} from "@modules/transcript/RichTranscriptContent/helpers";

import {
  diffLineClassByTone,
  diffStatusClassByChangeType
} from "./constants";
import { DiffStats } from "./DiffStats";
import { getDiffChangeLabel } from "./helpers";
import styles from "./styles.module.scss";
import type { TranscriptDiffModalProps } from "./types";

export function TranscriptDiffModal({
  group,
  onClose
}: TranscriptDiffModalProps) {
  const {
    dragHandleProps,
    sheetGestureProps,
    sheetRef
  } = useBottomSheetDrag<HTMLDivElement>({ onDismiss: onClose });
  const [primaryPart] = group.parts;
  const diffText = group.parts.map((part) => part.text).join("\n\n");
  const lines = splitDiffLines(diffText);
  const displayPath = group.displayPath;
  const statusLabel = getDiffStatusLabel(group.changeType);
  const changeLabel = getDiffChangeLabel(primaryPart.title, statusLabel);

  useModalFocusLifecycle({ dialogRef: sheetRef, onClose });

  const modal = (
    <div className={styles.diffModal}>
      <button
        aria-hidden="true"
        aria-label="Close diff"
        className={styles.diffModalBackdrop}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        className={styles.diffModalCard}
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={displayPath}
        {...sheetGestureProps}
        tabIndex={-1}
      >
        <div aria-hidden="true" className={styles.dragHandle} {...dragHandleProps} />
        <div
          className={clsx(styles.diffModalHeader, styles.dialogHeader)}
          {...dragHandleProps}
        >
          <div className={styles.dialogHeaderCopy}>
            <strong>{displayPath}</strong>
            <span className={styles.dialogHeaderMeta}>{changeLabel}</span>
          </div>
          <div className={styles.dialogHeaderActions}>
            <span
              aria-hidden="true"
              className={clsx(styles.diffStatus, diffStatusClassByChangeType[group.changeType])}
            >
              {getDiffStatusLetter(group.changeType)}
            </span>
            <DiffStats group={group} />
            <ModalCloseButton label="Close diff" onClick={onClose} />
          </div>
        </div>

        <div
          aria-label={displayPath}
          className={clsx(styles.diffModalBody, styles.diff)}
          role="region"
          tabIndex={0}
        >
          {lines.map((line, index) => {
            const tone = getDiffLineTone(line);
            const displayLine = line === "" ? " " : line;

            return (
              <div
                className={clsx(styles.diffLine, diffLineClassByTone[tone])}
                key={`${index}:${line}`}
              >
                <span className={styles.diffMarker} aria-hidden="true">
                  {getDiffLineMarker(line)}
                </span>
                <code>{displayLine}</code>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
