import type { ReactNode } from "react";

import styles from "@modules/agents/panel/styles.module.scss";

type Props = {
  action?: ReactNode;
  children: ReactNode;
};

export function AgentSessionsPanelSurface({ action, children }: Props) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <div>
          <h2>Recent chats</h2>
          <p>All local chats in one place</p>
        </div>
        {action}
      </header>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}
