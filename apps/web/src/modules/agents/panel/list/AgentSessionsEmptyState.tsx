import clsx from "clsx";

import styles from "@modules/agents/panel/styles.module.scss";
import type { AgentSessionsEmptyStateProps } from "@modules/agents/types";

export function AgentSessionsEmptyState(props: AgentSessionsEmptyStateProps) {
  const { hasSourceSessions, hasSearchQuery, isUnavailable = false, onRetry } = props;

  const hasActiveFilter = hasSourceSessions || hasSearchQuery;
  const retryIsFocusFallback = isUnavailable && Boolean(onRetry);

  return (
    <div className={clsx(styles.emptyState, styles.emptyStateSoft)}>
      <strong
        data-chat-list-focus-fallback={retryIsFocusFallback ? undefined : ""}
        data-chat-list-focus-priority={retryIsFocusFallback ? undefined : ""}
        tabIndex={retryIsFocusFallback ? undefined : -1}
      >
        {isUnavailable
          ? "Chat list is temporarily unavailable"
          : hasActiveFilter ? "No chats match this filter" : "No chats for this source yet"}
      </strong>
      <p>
        {isUnavailable
          ? "DeskCue could not reach the local daemon. Retry after it is available."
          : hasActiveFilter
          ? "Try another source or clear the search to see more local threads"
          : "Switch source or start a supported local chat. Codex and Claude Code sessions appear here automatically when they exist on this machine"}
      </p>
      {isUnavailable && onRetry ? (
        <button
          className={styles.button}
          data-chat-list-focus-fallback=""
          data-chat-list-focus-priority=""
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
