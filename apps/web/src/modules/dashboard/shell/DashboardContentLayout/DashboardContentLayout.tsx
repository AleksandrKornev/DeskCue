import clsx from "clsx";
import type { ReactNode } from "react";

import styles from "./styles.module.scss";

export type DashboardContentLayoutProps = {
  hasManagedFocus: boolean;
  showBootstrapShell: boolean;
  showSecondaryManagedSession: boolean;
  bootShell: ReactNode;
  focusedManagedSessionShell: ReactNode;
  liveOverlay: ReactNode;
  agentBrowserShell: ReactNode;
  secondaryManagedSessionShell: ReactNode;
};

export function DashboardContentLayout({
  hasManagedFocus,
  showBootstrapShell,
  showSecondaryManagedSession,
  bootShell,
  focusedManagedSessionShell,
  liveOverlay,
  agentBrowserShell,
  secondaryManagedSessionShell
}: DashboardContentLayoutProps) {
  return (
    <main
      className={clsx(styles.layout,
        showBootstrapShell
          ? styles.focusedChat
          : hasManagedFocus
            ? styles.focusedChat
            : styles.chatFirst,
        showBootstrapShell ? styles.boot : null
      )}
    >
      <section className={styles.workspace}>
        {showBootstrapShell ? (
          bootShell
        ) : hasManagedFocus ? (
          <>
            {focusedManagedSessionShell}
            {liveOverlay}
          </>
        ) : (
          <>
            {agentBrowserShell}
            {showSecondaryManagedSession ? secondaryManagedSessionShell : null}
          </>
        )}
      </section>
    </main>
  );
}
