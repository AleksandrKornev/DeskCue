import clsx from "clsx";

import styles from "./styles.module.scss";

export function PageSkeleton() {
  return (
    <section className={styles.pagePanel} aria-label="Loading page">
      <div className={styles.panelIntro}>
        <span className={clsx(styles.line, styles.linePanelTitle)} />
        <span className={clsx(styles.line, styles.linePanelSubtitle)} />
      </div>
      <div className={styles.pageCard}>
        <span className={clsx(styles.line, styles.lineWide)} />
        <span className={clsx(styles.line, styles.lineMid)} />
      </div>
      <div className={styles.pageCard}>
        <span className={clsx(styles.line, styles.lineWide)} />
        <span className={clsx(styles.line, styles.lineMid)} />
      </div>
      <div className={styles.pageCard}>
        <span className={clsx(styles.line, styles.lineWide)} />
        <span className={clsx(styles.line, styles.lineMid)} />
      </div>
    </section>
  );
}
