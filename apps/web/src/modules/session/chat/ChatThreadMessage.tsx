import clsx from "clsx";
import {
  memo,
  useMemo
} from "react";

import CopyIcon from "@assets/images/icon-copy.svg?react";
import { formatChatTime } from "@lib/format";
import { labelForTranscriptRole } from "@models/transcriptEntries";

import {
  ChatInlineActivityFeed,
  ChatMessageActivityChip
} from "./ChatThreadActivityBlocks";
import {
  messageClassByRole,
  messageFooterClassByRole,
  turnStatusClassByKind
} from "./constants";
import styles from "./styles.module.scss";
import { TranscriptContent } from "./TranscriptContent";
import type { ChatThreadMessageProps } from "./types";

export const ChatThreadMessage = memo(function ChatThreadMessage({
  assistantDisplayName,
  assetContext,
  copyFeedback,
  isActivityExpanded,
  isPrimaryMobileCopyAction,
  item,
  onHydrateActivityGroup,
  onCopyMessage,
  onToggleActivityGroup,
  renderActivityEntries
}: ChatThreadMessageProps) {
  const messageActivities = useMemo(
    () => [...item.activities, ...item.changeActivities],
    [item.activities, item.changeActivities]
  );

  const messageCopyStatus = copyFeedback?.messageId === item.entry.id
    ? copyFeedback.status
    : null;
  const copyActionLabel = messageCopyStatus === "copied"
    ? "Message copied"
    : messageCopyStatus === "failed"
      ? "Copy failed"
      : "Copy message";
  const activityChips = item.activities.map((activity) => (
    <ChatMessageActivityChip
      key={activity.id}
      activity={activity}
      isExpanded={isActivityExpanded(activity)}
      messageEntryId={item.entry.id}
      onToggle={() => onToggleActivityGroup(activity)}
    />
  ));

  return (
    <article
      key={item.key}
      className={clsx(
        styles.chatMessage,
        messageClassByRole[item.role],
        item.continued && styles.chatMessageContinued
      )}
      data-chat-message-id={item.entry.id}
    >
      <div className={styles.chatMessageBubble}>
        {!item.continued ? (
          <div className={styles.chatMessageMeta}>
            <span className={styles.chatMessageMetaPrimary}>
              <strong>
                {item.role === "assistant"
                  ? assistantDisplayName
                  : labelForTranscriptRole(item.role)}
              </strong>
              {item.entry.origin === "external" ? (
                <span className={styles.chatMessageOrigin}>External</span>
              ) : null}
              {activityChips}
            </span>
            <span>{formatChatTime(item.timestamp)}</span>
          </div>
        ) : (
          <div className={clsx(styles.chatMessageMeta, styles.chatMessageMetaContinued)}>
            {activityChips.length > 0 ? (
              <span className={styles.chatMessageMetaPrimary}>
                {activityChips}
              </span>
            ) : null}
            <span>{formatChatTime(item.timestamp)}</span>
          </div>
        )}
        <TranscriptContent
          assetContext={assetContext}
          collapseSecondaryParts
          entry={item.entry}
        />
        <ChatInlineActivityFeed
          activities={messageActivities}
          isActivityExpanded={isActivityExpanded}
          messageEntryId={item.entry.id}
          onHydrateActivity={onHydrateActivityGroup}
          renderActivityEntries={renderActivityEntries}
        />
        {item.turnStatus ? (
          <div className={styles.chatMessageTurnStatusRow}>
            <span
              className={clsx(
                styles.chatMessageTurnStatus,
                turnStatusClassByKind[item.turnStatus.kind]
              )}
              title={item.turnStatus.title}
            >
              {item.turnStatus.label}
            </span>
          </div>
        ) : null}
        {item.entry.text.trim() ? (
          <div
            className={clsx(
              styles.chatMessageFooter,
              messageFooterClassByRole[item.role],
              !isPrimaryMobileCopyAction && styles.chatMessageFooterMobileSecondary
            )}
          >
            <button
              aria-label="Copy message"
              className={styles.chatMessageAction}
              data-copy-status={messageCopyStatus ?? undefined}
              data-feedback-label={messageCopyStatus ? copyActionLabel : undefined}
              onClick={() => onCopyMessage(item.entry.id, item.entry.text)}
              title={copyActionLabel}
              type="button"
            >
              <CopyIcon
                className={styles.chatMessageActionIcon}
                aria-hidden="true"
                focusable="false"
              />
              <span>
                {messageCopyStatus === "copied"
                  ? "Copied"
                  : messageCopyStatus === "failed"
                    ? "Failed"
                    : "Copy"}
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
});
