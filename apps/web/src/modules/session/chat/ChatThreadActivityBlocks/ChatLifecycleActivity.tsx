import { memo } from "react";

import { formatChatTime } from "@lib/format";
import { getLifecycleActivityDetail } from "@modules/session/chat/helpers";
import styles from "@modules/session/chat/styles.module.scss";

import type { ChatLifecycleActivityProps } from "./types";

function formatLifecycleActivityDetail(
  kind: ChatLifecycleActivityProps["activity"]["kind"],
  detail: string | null
) {
  if (kind !== "context" || !detail) return detail;

  const trimmedDetail = detail.trimEnd();

  if (!trimmedDetail.endsWith(".") || trimmedDetail.endsWith("..")) return detail;

  return trimmedDetail.slice(0, -1);
}

export const ChatLifecycleActivity = memo(function ChatLifecycleActivity({
  activity
}: ChatLifecycleActivityProps) {
  const detail = formatLifecycleActivityDetail(
    activity.kind,
    getLifecycleActivityDetail(activity)
  );

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
