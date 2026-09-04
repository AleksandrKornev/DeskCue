import clsx from "clsx";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { CONNECTION_CONFIG_CHANGED_EVENT } from "@api/connection";
import HomeIcon from "@assets/images/icon-home.svg?react";
import { DeskCueWordmark } from "@components/DeskCueWordmark";

import { formatLogSourcePath, formatLogTimestamp } from "./helpers";
import {
  DAEMON_LOG_AUTO_REFRESH_OPTIONS,
  DaemonLogsStore
} from "./store/daemonLogsStore";
import styles from "./styles.module.scss";

function getLogLevelClassName(level: string) {
  switch (level.toLowerCase()) {
    case "error":
      return clsx(styles.logLevel, styles.logLevelError);
    case "warn":
    case "warning":
      return clsx(styles.logLevel, styles.logLevelWarning);
    case "info":
      return clsx(styles.logLevel, styles.logLevelInfo);
    default:
      return clsx(styles.logLevel, styles.logLevelMuted);
  }
}

function createLogEntryKey(entry: {
  context: unknown;
  level: string;
  message: string;
  timestamp: string | null | undefined;
}) {
  return [
    entry.timestamp ?? "no-timestamp",
    entry.level,
    entry.message,
    JSON.stringify(entry.context)
  ].join("\u001f");
}

function renderLogTimestamp(timestamp: string | null | undefined) {
  const label = formatLogTimestamp(timestamp);
  const parsedTimestamp = timestamp ? new Date(timestamp) : null;
  const dateTime = parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime())
    ? parsedTimestamp.toISOString()
    : undefined;

  if (!dateTime) {
    return <span className={styles.timestamp} title={timestamp ?? undefined}>{label}</span>;
  }

  return (
    <time className={styles.timestamp} dateTime={dateTime} title={timestamp ?? dateTime}>
      {label}
    </time>
  );
}

export const LogsPage = observer(function LogsPage() {
  const [store] = useState(() => new DaemonLogsStore());
  const autoRefreshMs = store.autoRefreshMs;
  const latestEntries = store.latestEntries;
  const logEntryKeyCounts = new Map<string, number>();

  useEffect(() => {
    store.loadOnMount();

    window.addEventListener(
      CONNECTION_CONFIG_CHANGED_EVENT,
      store.handleConnectionConfigChanged
    );

    return () => {
      window.removeEventListener(
        CONNECTION_CONFIG_CHANGED_EVENT,
        store.handleConnectionConfigChanged
      );
    };
  }, [store]);

  useEffect(() => {
    if (autoRefreshMs <= 0) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void store.refresh(false);
    }, autoRefreshMs);

    return () => window.clearInterval(intervalId);
  }, [autoRefreshMs, store]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link aria-label="Back to DeskCue dashboard" className={styles.backLink} to="/">
            <DeskCueWordmark className={styles.logoWordmark} />
            <HomeIcon className={styles.homeIcon} aria-hidden="true" focusable="false" />
          </Link>
          <h1>System logs</h1>
          <p>Operational events, request summaries, lifecycle logs, and local access activity</p>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.autoRefreshControl} htmlFor="daemon-log-auto-refresh">
            <span>Auto refresh</span>
            <select
              id="daemon-log-auto-refresh"
              name="daemon-log-auto-refresh"
              value={store.autoRefreshMs}
              onChange={(event) => store.setAutoRefreshMs(Number(event.target.value))}
            >
              {DAEMON_LOG_AUTO_REFRESH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={styles.refreshButton}
            disabled={store.refreshing}
            onClick={() => void store.refresh()}
            type="button"
          >
            {store.refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      <section className={styles.summary}>
        <div>
          <span className={styles.label}>Source</span>
          <strong
            aria-label={store.filePath ?? undefined}
            className={styles.sourcePath}
          >
            {store.filePath ? (
              <>
                <span className={styles.sourcePathFull}>{store.filePath}</span>
                <span aria-hidden="true" className={styles.sourcePathCompact}>
                  {formatLogSourcePath(store.filePath)}
                </span>
              </>
            ) : (
              store.loading
                ? "Loading log source..."
                : store.statusIsError
                  ? "Log source unavailable"
                  : "File logging is disabled or no log file exists"
            )}
          </strong>
        </div>
        <div>
          <span className={styles.label}>Entries</span>
          <strong>{store.entries.length}</strong>
        </div>
        <p aria-atomic="true" className={styles.liveRegion} role="status">
          {store.statusIsError ? "" : store.status}
        </p>
        <p aria-atomic="true" className={styles.liveRegion} role="alert">
          {store.statusIsError ? store.status : ""}
        </p>
      </section>

      <section
        aria-busy={store.refreshing}
        aria-label="System log entries"
        className={styles.logSurface}
      >
        {latestEntries.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>
              {store.loading
                ? "Loading system logs"
                : store.statusIsError
                  ? "Could not load system logs"
                  : "No log entries loaded"}
            </strong>
            <span>
              {store.loading
                ? "Waiting for the daemon response"
                : store.statusIsError
                  ? "Check the daemon connection and try refreshing"
                  : "Refresh after DeskCue writes operational events"}
            </span>
          </div>
        ) : (
          <ol aria-label="Latest system log entries" className={styles.logList} role="list">
            {latestEntries.map((entry, index) => {
              const baseKey = createLogEntryKey(entry);
              const occurrence = logEntryKeyCounts.get(baseKey) ?? 0;

              logEntryKeyCounts.set(baseKey, occurrence + 1);

              return (
                <li
                  key={`${baseKey}\u001f${occurrence}`}
                  aria-label={`Log entry ${index + 1} of ${latestEntries.length}`}
                  aria-posinset={index + 1}
                  aria-setsize={latestEntries.length}
                  className={styles.logListItem}
                  role="listitem"
                >
                  <article className={styles.logRow}>
                    <div className={styles.logHeader}>
                      <span className={getLogLevelClassName(entry.level)}>{entry.level}</span>
                      {renderLogTimestamp(entry.timestamp)}
                    </div>
                    <p className={styles.logMessage}>{entry.message}</p>
                    {entry.context ? (
                      <pre className={styles.context}>{JSON.stringify(entry.context, null, 2)}</pre>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
});
