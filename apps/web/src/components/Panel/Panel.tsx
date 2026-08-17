import clsx from "clsx";

import styles from "./styles.module.scss";
import type { PanelProps } from "./types";

export function Panel({
  title,
  action,
  children,
  className,
  headerHidden = false,
  subtitle
}: PanelProps) {
  return (
    <section className={clsx(styles.panel, className)}>
      {!headerHidden ? (
        <header className={styles.header}>
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {action ? <div>{action}</div> : null}
        </header>
      ) : null}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
