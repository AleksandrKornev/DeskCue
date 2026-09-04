import clsx from "clsx";
import type { ReactNode } from "react";

import styles from "@modules/agents/panel/styles.module.scss";

type Props = {
  action?: ReactNode;
  children: ReactNode;
  focusedDetail?: boolean;
};

export function AgentSessionsPanelSurface({ action, children, focusedDetail = false }: Props) {
  return (
    <section className={clsx(styles.panel, focusedDetail ? styles.panelFocusedDetail : null)}>
      {focusedDetail ? null : (
        <header className={styles.panelHeader}>
          <div>
            <h2 data-chat-list-focus-fallback="" tabIndex={-1}>Control room</h2>
            <p>Review what needs you, then active and recent work.</p>
          </div>
          {action}
        </header>
      )}
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}
