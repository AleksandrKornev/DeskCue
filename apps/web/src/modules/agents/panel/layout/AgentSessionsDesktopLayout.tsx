import styles from "@modules/agents/panel/styles.module.scss";
import type { AgentSessionsDesktopLayoutProps } from "@modules/agents/types";

import { AgentSessionSelectionEmptyState } from "./AgentSessionSelectionEmptyState";

export function AgentSessionsDesktopLayout(props: AgentSessionsDesktopLayoutProps) {
  const { sessionsList, transcriptPanel } = props;

  return (
    <div className={styles.layout}>
      {sessionsList}
      {transcriptPanel ?? <AgentSessionSelectionEmptyState />}
    </div>
  );
}
