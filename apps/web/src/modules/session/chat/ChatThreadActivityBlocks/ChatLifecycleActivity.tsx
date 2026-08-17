import { memo } from "react";

import { formatChatTime } from "@lib/format";
import { getLifecycleActivityDetail } from "@modules/session/chat/helpers";
import styles from "@modules/session/chat/styles.module.scss";

import type { ChatLifecycleActivityProps } from "./types";

export const ChatLifecycleActivity = memo(function ChatLifecycleActivity({
  activity
}: ChatLifecycleActivityProps) {
  const detail = getLifecycleActivityDetail(activity);

  return (
    <div className={styles.chatContextActivity}>
      <span className={styles.chatContextActivityText}>
        {activity.label}
        {detail ? <span>{detail}</span> : null}
      </span>
      <span className={styles.chatContextActivityTime}>
        {formatChatTime(activity.timestamp)}
      </span>
    </div>
  );
});
