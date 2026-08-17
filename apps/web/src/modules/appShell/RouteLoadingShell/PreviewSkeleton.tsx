import clsx from "clsx";

import { DashboardSkeleton } from "./DashboardSkeleton";
import styles from "./styles.module.scss";

export function PreviewSkeleton() {
  return (
    <section className={styles.previewGrid} aria-label="Loading chat preview">
      <div className={styles.previewRail}>
        <DashboardSkeleton />
      </div>
      <div className={styles.previewColumn}>
        <article className={styles.previewPanel}>
          <div className={styles.panelIntro}>
            <span className={clsx(styles.line, styles.linePanelTitle)} />
            <span className={clsx(styles.line, styles.linePanelSubtitle)} />
          </div>
          <div className={styles.backLine} />
          <div className={styles.previewHeader}>
            <span className={clsx(styles.line, styles.lineTitleWide)} />
            <span className={clsx(styles.line, styles.lineMetaWide)} />
          </div>
          <div className={styles.previewTurn}>
            <span className={clsx(styles.line, styles.lineWide)} />
            <span className={clsx(styles.line, styles.lineMid)} />
            <span className={clsx(styles.line, styles.lineShort)} />
          </div>
          <div className={styles.previewButton} />
        </article>
        <div className={styles.secondaryStack} aria-hidden="true">
          <div className={styles.secondaryCard}>
            <span className={clsx(styles.line, styles.linePanelTitle)} />
            <span className={clsx(styles.line, styles.linePanelSubtitle)} />
            <span className={styles.secondaryButton} />
          </div>
          <div className={styles.secondaryCard}>
            <span className={clsx(styles.line, styles.linePanelTitle)} />
            <span className={clsx(styles.line, styles.linePanelSubtitle)} />
            <span className={styles.secondaryButton} />
          </div>
        </div>
      </div>
    </section>
  );
}
