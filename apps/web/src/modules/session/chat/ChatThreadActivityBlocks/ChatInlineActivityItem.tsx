import clsx from "clsx";
import {
  memo,
  useEffect,
  useId
} from "react";

import { formatChatTime } from "@lib/format";
import styles from "@modules/session/chat/styles.module.scss";

import {
  inlineActivityBadgeClassByKind,
  inlineActivityToggleClassByKind
} from "./constants";
import {
  labelForActivityKind,
  shouldHydrateActivityOnExpand
} from "./helpers";
import type { ChatInlineActivityItemProps } from "./types";

export const ChatInlineActivityItem = memo(function ChatInlineActivityItem({
  activity,
  isExpanded,
  onHydrate,
  onToggle,
  renderActivityEntries,
  scrollExpandedContent = false
}: ChatInlineActivityItemProps) {
  const disclosureId = useId();
  const toggleId = `${disclosureId}-toggle`;
  const contentId = `${disclosureId}-content`;

  useEffect(() => {
    if (isExpanded && shouldHydrateActivityOnExpand(activity)) {
      onHydrate(activity);
    }
  }, [activity, isExpanded, onHydrate]);

  return (
    <div className={styles.chatInlineActivity}>
      <button
        aria-controls={isExpanded ? contentId : undefined}
        aria-expanded={isExpanded}
        className={clsx(
          styles.chatInlineActivityToggle,
          inlineActivityToggleClassByKind[activity.kind]
        )}
        onClick={onToggle}
        data-chat-activity-id={activity.id}
        id={toggleId}
        type="button"
      >
        <span className={styles.chatInlineActivityRow}>
          <span className={styles.chatInlineActivityLabel}>
            <span
              className={clsx(
                styles.chatInlineActivityBadge,
                inlineActivityBadgeClassByKind[activity.kind]
              )}
            >
              {labelForActivityKind(activity.kind)}
            </span>
            <span className={styles.chatInlineActivityLabelText}>{activity.label}</span>
          </span>
          <span className={styles.chatInlineActivityTime}>
            {formatChatTime(activity.timestamp)}
          </span>
        </span>
      </button>
      {isExpanded ? (
        <div
          aria-labelledby={toggleId}
          className={clsx(
            styles.chatInlineActivityContent,
            (activity.kind === "details" || activity.kind === "tools") &&
              styles.chatInlineActivityContentDetails,
            scrollExpandedContent &&
              (activity.kind === "details" || activity.kind === "tools") &&
              styles.chatInlineActivityContentScrollOwner
          )}
          id={contentId}
          role="region"
        >
          {renderActivityEntries(activity)}
        </div>
      ) : null}
    </div>
  );
});
