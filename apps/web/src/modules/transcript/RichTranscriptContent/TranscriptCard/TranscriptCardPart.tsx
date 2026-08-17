import clsx from "clsx";

import type { TranscriptPart } from "@deskcue/protocol";
import {
  createSyntheticDiffPart,
  looksLikeUnifiedDiff
} from "@modules/transcript/RichTranscriptContent/helpers";
import { TranscriptAttachmentCard } from "@modules/transcript/RichTranscriptContent/TranscriptAttachment";
import { TranscriptDiffList } from "@modules/transcript/RichTranscriptContent/TranscriptDiff";

import styles from "./styles.module.scss";

export function TranscriptCardPart(props: { part: Exclude<TranscriptPart, { type: "markdown" | "diff" }> }) {
  const { part } = props;

  if (part.type === "tool_call") {
    return (
      <div className={clsx(styles.card, styles.cardTool)}>
        <div className={styles.cardHeader}>
          <strong>Tool call</strong>
          <span>{part.namespace ? `${part.namespace}.${part.toolName}` : part.toolName}</span>
        </div>
        {part.argumentsText ? <pre className={styles.cardCode}>{part.argumentsText}</pre> : null}
      </div>
    );
  }

  if (part.type === "tool_result") {
    if (looksLikeUnifiedDiff(part.text)) {
      return (
        <TranscriptDiffList
          parts={[
            createSyntheticDiffPart(
              part.text,
              part.toolName ? `Diff from ${part.toolName}` : "Tool diff"
            )
          ]}
        />
      );
    }

    return (
      <div className={clsx(styles.card, styles.cardResult)}>
        <div className={styles.cardHeader}>
          <strong>Tool result</strong>
          <span>{part.toolName ?? part.status}</span>
        </div>
        <pre className={styles.cardCode}>{part.text}</pre>
      </div>
    );
  }

  if (part.type === "attachment") {
    return <TranscriptAttachmentCard part={part} />;
  }

  return (
    <div className={clsx(styles.card, styles.cardStatus)}>
      <div className={styles.cardHeader}>
        <strong>{part.label}</strong>
      </div>
      {part.detail ? <span className={styles.cardDetail}>{part.detail}</span> : null}
    </div>
  );
}
