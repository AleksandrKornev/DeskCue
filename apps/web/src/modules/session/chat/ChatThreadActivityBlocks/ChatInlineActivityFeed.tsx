import clsx from "clsx";
import {
  memo,
  useEffect,
  useMemo
} from "react";

import styles from "@modules/session/chat/styles.module.scss";

import { shouldHydrateActivityOnExpand } from "./helpers";
import type { ChatInlineActivityFeedProps } from "./types";

export const ChatInlineActivityFeed = memo(function ChatInlineActivityFeed({
  activities,
  isActivityExpanded,
  onHydrateActivity,
  renderActivityEntries
}: ChatInlineActivityFeedProps) {
  const expandedActivities = useMemo(
    () => activities.filter((activity) => isActivityExpanded(activity)),
    [activities, isActivityExpanded]
  );

  useEffect(() => {
    expandedActivities
      .filter(shouldHydrateActivityOnExpand)
      .forEach(onHydrateActivity);
  }, [expandedActivities, onHydrateActivity]);

  if (expandedActivities.length === 0) {
    return null;
  }

  return (
    <div className={styles.chatInlineActivityFeed}>
      {expandedActivities.map((activity) => (
        <div
          key={activity.id}
          className={clsx(
            styles.chatInlineActivityContent,
            (activity.kind === "details" || activity.kind === "tools") &&
              styles.chatInlineActivityContentDetails
          )}
        >
          {renderActivityEntries(activity)}
        </div>
      ))}
    </div>
  );
});
