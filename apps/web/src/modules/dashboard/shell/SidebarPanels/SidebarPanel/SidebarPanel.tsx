import clsx from "clsx";
import type { PropsWithChildren } from "react";

import styles from "./styles.module.scss";

export type SidebarPanelProps = PropsWithChildren<{
  compact: boolean;
  subtitle: string;
  title: string;
}>;

export function SidebarPanel({
  children,
  compact,
  subtitle,
  title
}: SidebarPanelProps) {
  return (
    <section className={clsx(styles.panel, compact && styles.secondaryPanel)}>
      <header className={clsx(styles.header, compact && styles.secondaryHeader)}>
        <div>
          <h2 className={compact ? styles.secondaryTitle : undefined}>{title}</h2>
          <p className={compact ? styles.secondarySubtitle : undefined}>{subtitle}</p>
        </div>
      </header>
      <div className={clsx(styles.body, compact && styles.secondaryBody)}>
        {children}
      </div>
    </section>
  );
}
