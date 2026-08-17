import clsx from "clsx";

import styles from "@modules/agents/panel/styles.module.scss";

export function AgentSessionSelectionEmptyState() {
  return (
    <div className={clsx(styles.emptyState, styles.selectionEmptyState)}>
      <strong>Select a chat to inspect</strong>
      <p>
        Pick a local agent chat from the list to review the transcript, then attach it when
        you want DeskCue to take over
      </p>
    </div>
  );
}
