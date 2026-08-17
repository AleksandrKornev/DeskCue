import clsx from "clsx";
import { memo } from "react";

import styles from "@modules/session/chat/styles.module.scss";

import { messageActivityChipClassByKind } from "./constants";
import type { ChatMessageActivityChipProps } from "./types";

export const ChatMessageActivityChip = memo(function ChatMessageActivityChip({
  activity,
  isExpanded,
  onToggle
}: ChatMessageActivityChipProps) {
  return (
    <button
      aria-expanded={isExpanded}
      className={clsx(
        styles.chatMessageActivityChip,
        messageActivityChipClassByKind[activity.kind]
      )}
      onClick={onToggle}
      type="button"
    >
      {activity.label}
    </button>
  );
});
