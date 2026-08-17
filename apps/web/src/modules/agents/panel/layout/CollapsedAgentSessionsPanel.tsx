import clsx from "clsx";

import { Panel } from "@components/Panel";
import styles from "@modules/agents/panel/styles.module.scss";
import type { CollapsedAgentSessionsPanelProps } from "@modules/agents/types";

export function CollapsedAgentSessionsPanel(props: CollapsedAgentSessionsPanelProps) {
  const { selectedAgentSession, onExpand } = props;

  return (
    <Panel
      title="Agent chat browser"
      subtitle="The live DeskCue session is already the main surface. Open this only when you want to switch threads"
      className={styles.panel}
    >
      <div className={styles.stack}>
        {selectedAgentSession ? (
          <div className={clsx(styles.listCard, styles.listCardCompact)}>
            <div className={styles.listCardHeader}>
              <strong>{selectedAgentSession.title}</strong>
              <span className={styles.sourcePill}>{selectedAgentSession.agentLabel}</span>
            </div>
            <span>{selectedAgentSession.workspacePath ?? "No workspace linked"}</span>
          </div>
        ) : null}

        <button
          className={clsx(styles.button, styles.ghostButton)}
          onClick={onExpand}
          type="button"
        >
          Browse agent chats
        </button>
      </div>
    </Panel>
  );
}
