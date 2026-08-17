import clsx from "clsx";

import { Panel, StatusBadge } from "@components/Panel";

import {
  findSourceAgentSession,
  formatSwitcherSubtitle,
  formatSwitcherTitle
} from "./helpers";
import styles from "./styles.module.scss";
import type { ManagedSessionSwitcherProps } from "./types";

export function ManagedSessionSwitcher({
  agentSessions,
  managedSessions,
  selectedSessionId,
  onSelectSession,
}: ManagedSessionSwitcherProps) {
  if (managedSessions.length <= 1) {
    return null;
  }

  return (
    <Panel
      title="Live DeskCue sessions"
      subtitle="Switch between chats or commands DeskCue is already running"
      className={styles.managedSessionSwitcher}
    >
      <div className={styles.managedStrip}>
        {managedSessions.map((session) => {
          const sourceAgentSession = findSourceAgentSession(session, agentSessions);

          return (
            <button
              key={session.id}
              className={clsx(
                styles.listCard,
                styles.listCardCompact,
                session.id === selectedSessionId && styles.listCardSelected
              )}
              onClick={() => onSelectSession(session.id)}
              type="button"
            >
              <div className={styles.listCardHeader}>
                <strong>{formatSwitcherTitle(session, sourceAgentSession)}</strong>
                <StatusBadge status={session.status} />
              </div>
              <span>{formatSwitcherSubtitle(session, sourceAgentSession)}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
