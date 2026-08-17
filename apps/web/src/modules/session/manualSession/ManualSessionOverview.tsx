import clsx from "clsx";

import { Panel } from "@components/Panel";
import { buildDebugLogEntries } from "@models/sessionDisplay";

import styles from "./styles.module.scss";
import type { ManualSessionOverviewProps } from "./types";

export function ManualSessionOverview({
  activeSelectedSession
}: ManualSessionOverviewProps) {
  if (!activeSelectedSession) {
    return (
      <div className={styles.stackLarge}>
        <div className={clsx(styles.skeletonBlock, styles.skeletonPanel)} />
        <div className={clsx(styles.skeletonBlock, styles.skeletonTerminal)} />
      </div>
    );
  }

  const recentOutput = buildDebugLogEntries(activeSelectedSession.logs.slice(-8), {
    mode: activeSelectedSession.sourceSessionId ? "taken-over" : "manual"
  })
    .map((log) => `[${log.stream}] ${log.text}`)
    .join("\n");

  return (
    <div className={styles.twoColumn}>
      <Panel
        title="Recent output"
        subtitle="Live surface before opening full logs"
      >
        <pre className={clsx(styles.terminal, styles.terminalCompact)}>
          {recentOutput.length === 0
            ? "Waiting for output..."
            : recentOutput}
        </pre>
      </Panel>

      <Panel
        title="Workspace state"
        subtitle="Artifact review stays visible while you drive the conversation"
      >
        {activeSelectedSession.git.changedFiles.length === 0 ? (
          <p className={styles.muted}>
            {activeSelectedSession.git.isGitRepo
              ? "Working tree is clean"
              : "This workspace is not a git repository"}
          </p>
        ) : (
          <ul className={styles.plainList}>
            {activeSelectedSession.git.changedFiles.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
