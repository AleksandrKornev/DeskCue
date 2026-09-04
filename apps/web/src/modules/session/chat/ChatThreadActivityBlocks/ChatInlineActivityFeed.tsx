import clsx from "clsx";
import {
  memo,
  useEffect,
  useMemo
} from "react";

import styles from "@modules/session/chat/styles.module.scss";

import {
  buildMessageActivityElementIds,
  shouldHydrateActivityOnExpand
} from "./helpers";
import type { ChatInlineActivityFeedProps } from "./types";

export const ChatInlineActivityFeed = memo(function ChatInlineActivityFeed({
  activities,
  isActivityExpanded,
  messageEntryId,
  onHydrateActivity,
  renderActivityEntries
}: ChatInlineActivityFeedProps) {
  const visibleActivities = useMemo(
    () => activities.filter(
      (activity) => activity.kind === "changes" || isActivityExpanded(activity)
    ),
    [activities, isActivityExpanded]
  );

  useEffect(() => {
    visibleActivities
      .filter(shouldHydrateActivityOnExpand)
      .forEach(onHydrateActivity);
  }, [onHydrateActivity, visibleActivities]);

  if (visibleActivities.length === 0) {
    return null;
  }

  return (
    <div className={styles.chatInlineActivityFeed}>
      {visibleActivities.map((activity) => (
        <div
          key={activity.id}
          aria-label={activity.kind === "changes" ? activity.label : undefined}
          aria-labelledby={activity.kind === "changes"
            ? undefined
            : buildMessageActivityElementIds(messageEntryId, activity.id).triggerId}
          className={clsx(
            styles.chatInlineActivityContent,
            (activity.kind === "details" || activity.kind === "tools") &&
              styles.chatInlineActivityContentDetails
          )}
          data-chat-activity-id={activity.kind === "changes" ? activity.id : undefined}
          id={buildMessageActivityElementIds(messageEntryId, activity.id).contentId}
          role="region"
          tabIndex={activity.kind === "changes" ? -1 : undefined}
        >
          {renderActivityEntries(activity)}
        </div>
      ))}
    </div>
  );
});
