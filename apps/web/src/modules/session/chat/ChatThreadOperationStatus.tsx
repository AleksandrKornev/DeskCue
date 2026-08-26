import clsx from "clsx";
import { useState } from "react";

import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";
import { formatDate } from "@lib/format";
import { labelForTranscriptRole } from "@models/transcriptEntries";
import { shouldRenderTranscriptEntryBare } from "@modules/transcript";

import { activityEntryClassByRole } from "./constants";
import { retryRecoveredPrompt } from "./helpers";
import styles from "./styles.module.scss";
import { TranscriptContent } from "./TranscriptContent";
import type { ChatThreadOperationState } from "./types";

export function ChatThreadOperationStatus({
  assistantDisplayName,
  assetContext,
  operation,
  onRetryRecoveredPrompt
}: {
  assistantDisplayName: string;
  assetContext?: LocalAssetLinkContext;
  operation: Exclude<ChatThreadOperationState, { kind: "idle" }>;
  onRetryRecoveredPrompt: () => Promise<boolean>;
}) {
  const [isRetryingRecoveredPrompt, setIsRetryingRecoveredPrompt] = useState(false);

  if (operation.kind === "stopping") {
    return (
      <div className={styles.chatWaiting}>
        <strong>Stopping current prompt</strong>
        <span className={styles.chatWaitingPendingRow}>
          <span className={styles.chatWaitingSpinner} aria-hidden="true" />
          DeskCue sent the stop request and is finalizing this chat
        </span>
      </div>
    );
  }

  if (operation.kind === "interrupt-unconfirmed") {
    return (
      <div className={styles.chatWaiting}>
        <strong>Interrupt unconfirmed</strong>
        <span>DeskCue has not received source confirmation; the prompt may still be running.</span>
      </div>
    );
  }

  if (operation.kind === "recovery") {
    return (
      <div className={clsx(styles.chatWaiting, styles.chatWaitingPending)}>
        <strong>{operation.title}</strong>
        <span>{operation.detail}</span>
        {operation.actionLabel ? (
          <button
            className={clsx(styles.smallGhostButton, styles.chatRecoveryAction)}
            disabled={isRetryingRecoveredPrompt}
            onClick={() => void retryRecoveredPrompt(
              operation,
              isRetryingRecoveredPrompt,
              setIsRetryingRecoveredPrompt,
              onRetryRecoveredPrompt
            )}
            type="button"
          >
            {isRetryingRecoveredPrompt ? "Sending..." : operation.actionLabel}
          </button>
        ) : null}
      </div>
    );
  }

  const agentDisplayName = assistantDisplayName || "agent";
  const detailEntry = operation.detailEntry;
  const waitingStatusMessage = detailEntry
    ? "Showing the latest live detail until the final reply lands"
    : operation.source === "external"
      ? "DeskCue is monitoring a turn started outside DeskCue"
      : "DeskCue already sent the prompt and is watching the local chat file";

  return (
    <div
      className={clsx(
        styles.chatWaiting,
        styles.chatWaitingReply,
        detailEntry && styles.chatWaitingDetail,
        !detailEntry && styles.chatWaitingPending
      )}
    >
      <strong>Waiting for {agentDisplayName} reply</strong>
      <span className={styles.chatWaitingPendingRow}>
        <span className={styles.chatWaitingSpinner} aria-hidden="true" />
        <span>{waitingStatusMessage}</span>
      </span>
      {detailEntry ? (
        shouldRenderTranscriptEntryBare(detailEntry) ? (
          <TranscriptContent assetContext={assetContext} entry={detailEntry} />
        ) : (
          <article
            className={clsx(
              styles.activityEntry,
              activityEntryClassByRole[detailEntry.role],
              styles.chatWaitingDetailEntry
            )}
          >
            <header className={styles.activityEntryHeader}>
              {detailEntry.role !== "commentary" ? (
                <strong>{labelForTranscriptRole(detailEntry.role)}</strong>
              ) : null}
              <span>{formatDate(detailEntry.timestamp)}</span>
            </header>
            <TranscriptContent assetContext={assetContext} entry={detailEntry} />
          </article>
        )
      ) : null}
    </div>
  );
}
