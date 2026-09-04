import clsx from "clsx";
import { memo } from "react";

import styles from "@modules/session/chat/styles.module.scss";

import { messageActivityChipClassByKind } from "./constants";
import { buildMessageActivityElementIds } from "./helpers";
import type { ChatMessageActivityChipProps } from "./types";

export const ChatMessageActivityChip = memo(function ChatMessageActivityChip({
  activity,
  isExpanded,
  messageEntryId,
  onToggle
}: ChatMessageActivityChipProps) {
  const { contentId, triggerId } = buildMessageActivityElementIds(messageEntryId, activity.id);

  return (
    <button
      aria-controls={isExpanded ? contentId : undefined}
      aria-expanded={isExpanded}
      className={clsx(
        styles.chatMessageActivityChip,
        messageActivityChipClassByKind[activity.kind]
      )}
      data-chat-activity-id={activity.id}
      id={triggerId}
      onClick={onToggle}
      type="button"
    >
      {activity.label}
    </button>
  );
});
