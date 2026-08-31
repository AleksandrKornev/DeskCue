import clsx from "clsx";

import { DeskCueWordmark } from "@components/DeskCueWordmark";

import { DashboardSkeleton } from "./DashboardSkeleton";
import { readLoadingStatusLabel, readLoadingVariant } from "./helpers";
import { PageSkeleton } from "./PageSkeleton";
import { SessionSkeleton } from "./SessionSkeleton";
import styles from "./styles.module.scss";
import type { RouteLoadingShellProps } from "./types";

export function RouteLoadingShell({ pathname, search }: RouteLoadingShellProps) {
  const variant = readLoadingVariant(pathname, search);
  const loadingStatusLabel = readLoadingStatusLabel(variant);

  return (
    <main className={clsx(styles.shell, styles[`shell_${variant}`])} aria-busy="true">
      {variant === "session" ? null : (
        <p className={styles.visuallyHidden} role="status">{loadingStatusLabel}</p>
      )}
      {variant === "session" ? null : (
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <DeskCueWordmark className={styles.wordmark} />
          </div>
          <div className={styles.headerMeta}>
            <span className={styles.metaPill} />
            <span className={styles.metaPill} />
            <span className={styles.metaPill} />
          </div>
          <span className={styles.settingsButton} aria-hidden="true" />
        </header>
      )}

      {variant === "session" ? (
        <SessionSkeleton />
      ) : variant === "page" ? (
        <PageSkeleton />
      ) : (
        <DashboardSkeleton />
      )}
    </main>
  );
}
