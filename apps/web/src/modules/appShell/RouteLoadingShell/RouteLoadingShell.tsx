import clsx from "clsx";

import { DeskCueWordmark } from "@components/DeskCueWordmark";

import { DashboardSkeleton } from "./DashboardSkeleton";
import { readLoadingVariant } from "./helpers";
import { PageSkeleton } from "./PageSkeleton";
import { PreviewSkeleton } from "./PreviewSkeleton";
import { SessionSkeleton } from "./SessionSkeleton";
import styles from "./styles.module.scss";
import type { RouteLoadingShellProps } from "./types";

export function RouteLoadingShell({ pathname, search }: RouteLoadingShellProps) {
  const variant = readLoadingVariant(pathname, search);

  return (
    <main className={clsx(styles.shell, styles[`shell_${variant}`])} aria-busy="true">
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
      ) : variant === "preview" ? (
        <PreviewSkeleton />
      ) : variant === "page" ? (
        <PageSkeleton />
      ) : (
        <DashboardSkeleton />
      )}
    </main>
  );
}
