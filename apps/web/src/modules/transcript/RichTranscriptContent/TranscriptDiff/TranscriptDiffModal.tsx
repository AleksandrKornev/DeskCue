import clsx from "clsx";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import CloseIcon from "@assets/images/icon-close.svg?react";
import { useBottomSheetDrag } from "@components/BottomSheet";
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const modal = (
    <div className={styles.diffModal}>
      <button
        aria-label="Close diff"
        className={styles.diffModalBackdrop}
        onClick={onClose}
        type="button"
      />
      <div
        className={styles.diffModalCard}
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={displayPath}
        {...sheetGestureProps}
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
              className={clsx(styles.diffStatus, diffStatusClassByChangeType[group.changeType])}
            >
              {getDiffStatusLetter(group.changeType)}
            </span>
            <DiffStats group={group} />
            <button
              aria-label="Close diff"
              className={styles.dialogIconClose}
              onClick={onClose}
              type="button"
            >
              <CloseIcon className={styles.dialogCloseIcon} aria-hidden="true" focusable="false" />
            </button>
          </div>
        </div>

        <div className={clsx(styles.diffModalBody, styles.diff)} role="region" aria-label={displayPath}>
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
