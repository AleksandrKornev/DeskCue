import type { TranscriptPart } from "@deskcue/protocol";

import {
  buildSecondaryPartsLabel,
  getRenderableTranscriptParts,
  orderAttachmentsBeforeMarkdown,
  shouldOrderAttachmentsBeforeMarkdown
} from "./helpers";
import { renderTranscriptParts } from "./renderTranscriptParts";
import styles from "./styles.module.scss";
import type { RichTranscriptContentProps } from "./types";

export function RichTranscriptContent(props: RichTranscriptContentProps) {
  const { assetContext, collapseSecondaryParts = false, entry } = props;

  const parts =
    entry.parts && entry.parts.length > 0
      ? getRenderableTranscriptParts(entry.parts)
      : [
          {
            type: "markdown",
            text: entry.text
          } satisfies TranscriptPart
        ];
  const orderedParts = shouldOrderAttachmentsBeforeMarkdown(entry)
    ? orderAttachmentsBeforeMarkdown(parts)
    : parts;

  if (!collapseSecondaryParts) {
    return (
      <div className={styles.richTranscript}>
        {renderTranscriptParts(orderedParts, "full", assetContext)}
      </div>
    );
  }

  const primaryParts = orderedParts.filter(
    (part) => part.type === "markdown" || part.type === "attachment"
  );

  const secondaryParts = orderedParts.filter(
    (part) => part.type !== "markdown" && part.type !== "attachment"
  );

  return (
    <div className={styles.richTranscript}>
      {renderTranscriptParts(primaryParts, "primary", assetContext, { compactAttachments: true })}

      {secondaryParts.length > 0 ? (
        <details className={styles.collapse}>
          <summary className={styles.collapseToggle}>
            <span className={styles.collapseRow}>
              <span>{buildSecondaryPartsLabel(secondaryParts)}</span>
              <span className={styles.collapseIcon} aria-hidden="true">
                ▾
              </span>
            </span>
          </summary>
          <div className={styles.collapseContent}>
            {renderTranscriptParts(secondaryParts, "collapsed", assetContext)}
          </div>
        </details>
      ) : null}
    </div>
  );
}
