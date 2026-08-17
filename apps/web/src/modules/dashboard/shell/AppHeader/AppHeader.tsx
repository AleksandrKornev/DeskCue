import clsx from "clsx";
import { Link } from "react-router";

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
  const { features, mode } = useDeskCueRuntime();
  const isRemote = mode !== "local";

  return (
    <header className={clsx(styles.topbar, isCompact ? styles.compact : null)}>
      <div className={styles.brandSlot}>
        <button
          className={styles.brandButton}
          aria-label="Back to DeskCue dashboard"
          onClick={onGoHome}
          type="button"
        >
          <DeskCueWordmark className={styles.brandWordmark} />
        </button>
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
              label="Chats"
              title={`${discoveredCount} discovered chats`}
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
              label="Run"
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
          <h1>{isRemote ? "Review your remote agent chats" : "Take over local agent chats"}</h1>
          <p className={styles.subtitle}>
            {isRemote
              ? "Inspect synced sessions, transcripts, tools, and changes in read-only mode"
              : "Pick a local thread, inspect it, then take it over when you want DeskCue to drive it"}
          </p>
        </div>
      ) : null}
    </header>
  );
}
