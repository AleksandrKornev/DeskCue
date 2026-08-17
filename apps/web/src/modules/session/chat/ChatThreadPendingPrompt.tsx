import clsx from "clsx";

import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";

import styles from "./styles.module.scss";
import { TranscriptContent } from "./TranscriptContent";
import type { ChatThreadPendingPrompt } from "./types";

export function ChatThreadPendingPrompt({
  assetContext,
  prompt
}: {
  assetContext?: LocalAssetLinkContext;
  prompt: ChatThreadPendingPrompt;
}) {
  return (
    <article className={clsx(styles.chatMessage, styles.chatMessageUser, styles.chatMessagePending)}>
      <div className={styles.chatMessageMeta}>
        <strong>User</strong>
        <span>{prompt.statusLabel}</span>
      </div>
      <TranscriptContent
        assetContext={assetContext}
        collapseSecondaryParts
        entry={{
          text: prompt.text,
          parts: [
            {
              type: "markdown",
              text: prompt.text
            }
          ]
        }}
      />
      {prompt.turnStatus ? (
        <div className={styles.chatMessageTurnStatusRow}>
          <span
            className={clsx(
              styles.chatMessageTurnStatus,
              styles.chatMessageTurnStatusSuperseded
            )}
            title={prompt.turnStatus.title}
          >
            {prompt.turnStatus.label}
          </span>
        </div>
      ) : null}
    </article>
  );
}
