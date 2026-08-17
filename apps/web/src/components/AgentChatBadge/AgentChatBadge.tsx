import clsx from "clsx";

import styles from "./styles.module.scss";

type AgentChatBadgeProps = {
  className?: string;
};

export function AgentChatBadge({ className }: AgentChatBadgeProps) {
  return (
    <span className={clsx(styles.badge, className)} title="Spawned by a parent agent">
      Subagent
    </span>
  );
}
