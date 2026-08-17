import clsx from "clsx";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";

import type { RouteViewState } from "@models/dashboardRoute";
import { AppHeader } from "@modules/dashboard/shell/AppHeader";
import { DashboardContentLayout } from "@modules/dashboard/shell/DashboardContentLayout";
import { useDashboardShellController } from "@modules/dashboard/shell/hooks";
import type { DashboardState } from "@modules/dashboard/shell/hooks";
import { useDeskCueEmbeddedReady, useDeskCueLayoutMode } from "@web/layout";

import styles from "./styles.module.scss";

export type DashboardShellProps = {
  dashboard: DashboardState;
  routeState: RouteViewState;
};

export const DashboardShell = observer(function DashboardShell({
  dashboard,
  routeState
}: DashboardShellProps) {
  const layoutMode = useDeskCueLayoutMode();
  const onEmbeddedReady = useDeskCueEmbeddedReady();
  const hasNotifiedEmbeddedReady = useRef(false);
  const {
    showHeader,
    headerProps,
    error,
    contentLayoutProps
  } = useDashboardShellController({ dashboard, routeState });
  const hasWideManagedShell = contentLayoutProps.hasManagedFocus;

  useEffect(() => {
    if (
      !hasNotifiedEmbeddedReady.current &&
      layoutMode === "embedded" &&
      !contentLayoutProps.showBootstrapShell
    ) {
      hasNotifiedEmbeddedReady.current = true;
      onEmbeddedReady?.();
    }
  }, [contentLayoutProps.showBootstrapShell, layoutMode, onEmbeddedReady]);

  return (
    <div
      className={clsx(
        styles.appShell,
        contentLayoutProps.hasManagedFocus ? styles.focusedChat : null,
        hasWideManagedShell ? styles.wideManagedShell : null,
        layoutMode === "embedded" ? styles.embedded : null
      )}
    >
      {showHeader ? <AppHeader {...headerProps} /> : null}

      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <DashboardContentLayout {...contentLayoutProps} />
    </div>
  );
});
