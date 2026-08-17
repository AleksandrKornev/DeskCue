import styles from "./styles.module.scss";
import type { TabPanelSurfaceProps } from "./types";

export function TabPanelSurface({
  title,
  action,
  children,
  subtitle
}: TabPanelSurfaceProps) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </header>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}
