import clsx from "clsx";

import styles from "./styles.module.scss";

export function DashboardSkeleton() {
  return (
    <section className={styles.dashboardGrid} aria-hidden="true">
      <div className={styles.panelIntro}>
        <span className={clsx(styles.line, styles.linePanelTitle)} />
        <span className={clsx(styles.line, styles.linePanelSubtitle)} />
      </div>
      <div className={styles.attentionSkeleton} aria-hidden="true">
        <span className={styles.attentionSkeletonSection} />
        <span className={styles.attentionSkeletonSection} />
      </div>
      <div className={styles.sourceStrip}>
        <span className={clsx(styles.tabPill, styles.tabPillActive)} />
        <span className={styles.tabPill} />
        <span className={styles.tabPill} />
      </div>
      <div className={styles.searchField} />
      <div className={styles.listSummary} />
      <div className={styles.chatList}>
        {Array.from({ length: 6 }).map((_, index) => (
          <article className={styles.chatCard} key={index}>
            <span className={clsx(styles.line, styles.lineTitle)} />
            <span className={clsx(styles.line, styles.lineMeta)} />
            <span className={clsx(styles.line, styles.lineDate)} />
          </article>
        ))}
      </div>
    </section>
  );
}
