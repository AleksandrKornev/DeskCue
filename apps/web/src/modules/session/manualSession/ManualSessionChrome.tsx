import clsx from "clsx";

import { KeyValue, StatusBadge } from "@components/Panel";
import { SegmentedTabs } from "@components/SegmentedTabs";
import { formatDate } from "@lib/format";
import {
  formatManagedSessionSubtitle,
  formatManagedSessionTitle
} from "@models/sessionDisplay";
import {
  getSessionTabLabel,
  getSessionTabsForCapabilities
} from "@models/sessionTabs";

import styles from "./styles.module.scss";
import type { ManualSessionChromeProps } from "./types";

export function ManualSessionChrome({
  activeSelectedSession,
  activeTab,
  navigationCapabilities,
  navigationIdPrefix,
  sessionShell,
  takenOverAgentSession,
  onExitSession,
  onRefreshGit,
  onSelectTab,
  onStopSession,
}: ManualSessionChromeProps) {
  return (
    <>
      <div className={styles.sessionHeader}>
        <div>
          <div className={styles.sessionHeaderTitle}>
            <h2>Manual command</h2>
            <StatusBadge status={sessionShell.status} />
          </div>
          <p className={styles.sessionHeaderCommand}>
            {formatManagedSessionTitle(sessionShell, takenOverAgentSession)}
          </p>
          <p className={styles.muted}>
            {formatManagedSessionSubtitle(sessionShell, takenOverAgentSession)}
          </p>
        </div>
        <div className={styles.actions}>
          {onRefreshGit ? (
            <button className={styles.ghostButton} onClick={onRefreshGit} type="button">
              Refresh changes
            </button>
          ) : null}
          <button className={styles.ghostButton} onClick={onExitSession} type="button">
            Back
          </button>
          {sessionShell.status === "running" ? (
            <button className={styles.dangerButton} onClick={onStopSession} type="button">
              Stop
            </button>
          ) : null}
        </div>
      </div>

      {activeSelectedSession ? (
        <div className={clsx(styles.summaryGrid, styles.summaryGridFour)}>
          <KeyValue
            className={styles.summaryKeyValue}
            label="Mode"
            value={activeSelectedSession.sourceSessionId ? "taken over chat" : "manual command"}
            valueClassName={styles.summaryKeyValueValue}
          />
          <KeyValue
            className={styles.summaryKeyValue}
            label="Started"
            value={formatDate(activeSelectedSession.startedAt)}
            valueClassName={styles.summaryKeyValueValue}
          />
          <KeyValue
            className={styles.summaryKeyValue}
            label="Branch"
            value={activeSelectedSession.git.branch ?? "n/a"}
            valueClassName={styles.summaryKeyValueValue}
          />
          <KeyValue
            className={styles.summaryKeyValue}
            label="Preview port"
            value={activeSelectedSession.preview.port ?? "off"}
            valueClassName={styles.summaryKeyValueValue}
          />
        </div>
      ) : null}

      <SegmentedTabs
        activeTab={activeTab}
        ariaLabel="Session sections"
        idPrefix={navigationIdPrefix}
        mobileLayout="fill"
        options={getSessionTabsForCapabilities(navigationCapabilities).map((tab) => ({
          key: tab.key,
          label: getSessionTabLabel(tab, navigationCapabilities)
        }))}
        onSelectTab={onSelectTab}
      />
    </>
  );
}
