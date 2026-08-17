import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { CONNECTION_CONFIG_CHANGED_EVENT } from "@api/connection";
import { DeskCueWordmark } from "@components/DeskCueWordmark";

import { formatLogTimestamp } from "./helpers";
import {
  DAEMON_LOG_AUTO_REFRESH_OPTIONS,
  DaemonLogsStore
} from "./store/daemonLogsStore";
import styles from "./styles.module.scss";

export const LogsPage = observer(function LogsPage() {
  const [store] = useState(() => new DaemonLogsStore());
  const autoRefreshMs = store.autoRefreshMs;

  useEffect(() => {
    const handleConnectionConfigChanged = () => {
      store.resetForConnectionChange();
      store.loadOnMount();
    };

    store.loadOnMount();
    window.addEventListener(
      CONNECTION_CONFIG_CHANGED_EVENT,
      handleConnectionConfigChanged
    );

    return () => {
      window.removeEventListener(
        CONNECTION_CONFIG_CHANGED_EVENT,
        handleConnectionConfigChanged
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
          <Link className={styles.backLink} to="/">
            <DeskCueWordmark className={styles.logoWordmark} />
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
            disabled={store.loading}
            onClick={() => void store.refresh()}
            type="button"
          >
            {store.loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      <section className={styles.summary}>
        <div>
          <span className={styles.label}>Source</span>
          <strong>{store.filePath ?? "File logging is disabled or no log file exists"}</strong>
        </div>
        <div>
          <span className={styles.label}>Entries</span>
          <strong>{store.entries.length}</strong>
        </div>
        {store.status ? <p>{store.status}</p> : null}
      </section>

      <section className={styles.logSurface} aria-label="System log entries">
        {store.latestEntries.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>No log entries loaded</strong>
            <span>Refresh after DeskCue writes operational events</span>
          </div>
        ) : (
          store.latestEntries.map((entry, index) => (
            <article key={`${entry.timestamp ?? "log"}-${index}`} className={styles.logRow}>
              <div className={styles.logHeader}>
                <span className={styles.logLevel}>{entry.level}</span>
                <span className={styles.timestamp} title={entry.timestamp ?? undefined}>
                  {formatLogTimestamp(entry.timestamp)}
                </span>
              </div>
              <p className={styles.logMessage}>{entry.message}</p>
              {entry.context ? (
                <pre className={styles.context}>{JSON.stringify(entry.context, null, 2)}</pre>
              ) : null}
            </article>
          ))
        )}
      </section>
    </main>
  );
});
