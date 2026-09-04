import clsx from "clsx";
import { Link, useLocation } from "react-router";

import SettingsIcon from "@assets/images/icon-settings.svg?react";
import { DeskCueWordmark } from "@components/DeskCueWordmark";
import { useDeskCueRuntime } from "@runtime";

import { CloudConnectionAffordance } from "./CloudConnectionAffordance";
import { HeaderMetric } from "./HeaderMetric";
import styles from "./styles.module.scss";
import type { AppHeaderProps } from "./types";

export function AppHeader({
  discoveredCount,
  managedCount,
  runningChatCount,
  isBootstrapping,
  isFocusedChat = false,
  isBootShell = false,
  onGoHome
}: AppHeaderProps) {
  const isCompact = isFocusedChat || isBootShell;
  const location = useLocation();
  const runtime = useDeskCueRuntime();
  const { features, mode } = runtime;
  const isRemote = mode !== "local";
  const canGoHome = Boolean(onGoHome) && (
    runtime.readAppPath(location.pathname) !== "/" ||
    Boolean(location.search) ||
    Boolean(location.hash)
  );

  return (
    <header className={clsx(styles.topbar, isCompact ? styles.compact : null)}>
      <div className={styles.brandSlot}>
        {canGoHome ? (
          <button
            className={styles.brandButton}
            aria-label="Back to DeskCue dashboard"
            onClick={onGoHome}
            type="button"
          >
            <DeskCueWordmark className={styles.brandWordmark} />
          </button>
        ) : (
          <span className={styles.brandHome} aria-hidden="true">
            <DeskCueWordmark className={styles.brandWordmark} />
          </span>
        )}
      </div>
      <div className={styles.meta}>
        {isBootstrapping ? (
          <div className={styles.metricGroup}>
            <span className={styles.skeletonPill} aria-hidden="true" />
            <span className={styles.skeletonPill} aria-hidden="true" />
            <span className={styles.skeletonPill} aria-hidden="true" />
          </div>
        ) : (
          <div className={styles.metricGroup}>
            <HeaderMetric
              icon="threads"
              label="Agent chats"
              title={`${discoveredCount} source-agent chats`}
              value={discoveredCount}
            />
            <HeaderMetric
              icon="managed"
              label="Attached"
              title={`${managedCount} chats attached to DeskCue`}
              value={managedCount}
            />
            <HeaderMetric
              icon="runtime"
              label="Running"
              title={`${runningChatCount} chats running`}
              value={runningChatCount}
            />
          </div>
        )}
      </div>
      <div className={styles.actionGroup}>
        {features.cloudConnection ? <CloudConnectionAffordance /> : null}
        {features.accessSettings ? (
          <Link
            aria-label="Open settings"
            className={styles.iconButton}
            title="Settings"
            to="/settings"
          >
            <SettingsIcon className={styles.settingsIcon} aria-hidden="true" focusable="false" />
          </Link>
        ) : null}
      </div>
      {!isCompact ? (
        <div className={styles.copy}>
          <h1>{isRemote ? "Remote agent review" : "Local agent control"}</h1>
          <p className={styles.subtitle}>
            {isRemote
              ? "Inspect synced sessions, transcripts, tools, and changes in read-only mode."
              : "Review, approve, and redirect work running on this machine."}
          </p>
        </div>
      ) : null}
    </header>
  );
}
