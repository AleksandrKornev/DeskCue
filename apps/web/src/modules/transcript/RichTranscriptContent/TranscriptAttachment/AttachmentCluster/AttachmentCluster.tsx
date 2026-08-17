import clsx from "clsx";
import { useState } from "react";

import {
  getAttachmentDisplayName
} from "@modules/transcript/RichTranscriptContent/helpers";
import { TranscriptAttachmentCard } from "@modules/transcript/RichTranscriptContent/TranscriptAttachment/TranscriptAttachment";

import { AttachmentClusterItem } from "./AttachmentClusterItem";
import styles from "./styles.module.scss";
import type { AttachmentClusterProps } from "./types";

export function AttachmentCluster(props: AttachmentClusterProps) {
  const { assetContext, dense = false, parts } = props;

  const [selectedIndex, setSelectedIndex] = useState(0);

  const safeSelectedIndex = Math.min(selectedIndex, parts.length - 1);
  const selectedPart = parts[safeSelectedIndex];

  return (
    <div className={clsx(styles.attachmentGroup, dense && styles.attachmentGroupDense)}>
      <div className={styles.attachmentGroupHeader}>
        <div>
          <strong>Assets</strong>
          <span>{parts.length} files attached</span>
        </div>
        <span className={styles.attachmentGroupCounter}>
          {safeSelectedIndex + 1}/{parts.length}
        </span>
      </div>

      <div className={styles.attachmentGroupRail} role="tablist" aria-label="Message assets">
        {parts.map((part, index) => (
          <AttachmentClusterItem
            isActive={index === safeSelectedIndex}
            key={`${getAttachmentDisplayName(part)}-${index}`}
            onSelect={() => setSelectedIndex(index)}
            part={part}
            assetContext={assetContext}
          />
        ))}
      </div>

      <TranscriptAttachmentCard assetContext={assetContext} compact dense={dense} part={selectedPart} />
    </div>
  );
}
