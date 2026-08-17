import clsx from "clsx";

import styles from "@modules/agents/panel/styles.module.scss";

import { SkeletonListCard } from "./SkeletonListCard";

export function AgentSessionsSkeleton() {
  return (
    <div className={clsx(styles.stack, styles.stackLarge)}>
      <div className={styles.attentionSkeleton} aria-hidden="true">
        <div className={clsx(styles.skeletonBlock, styles.attentionSkeletonSection)} />
        <div className={clsx(styles.skeletonBlock, styles.attentionSkeletonSection)} />
      </div>
      <div className={styles.toolbar}>
        <div className={styles.sourceStrip}>
          <div className={clsx(styles.sourceTab, styles.skeletonPill, styles.skeletonTab)} aria-hidden="true" />
          <div className={clsx(styles.sourceTab, styles.skeletonPill, styles.skeletonTab)} aria-hidden="true" />
          <div className={clsx(styles.sourceTab, styles.skeletonPill, styles.skeletonTab)} aria-hidden="true" />
        </div>
        <div
          className={clsx(styles.field, styles.skeletonBlock, styles.skeletonField, styles.agentSearch)}
          aria-hidden="true"
        />
      </div>

      <div className={styles.layout}>
        <div className={styles.list}>
          <div className={clsx(styles.listSummary, styles.listSummarySkeleton)}>
            <div className={clsx(styles.skeletonPill, styles.skeletonSummary)} aria-hidden="true" />
          </div>
          <div className={styles.listCards}>
            <SkeletonListCard />
            <SkeletonListCard />
            <SkeletonListCard />
            <SkeletonListCard />
          </div>
        </div>

        <div className={clsx(styles.stack, styles.skeletonDetail)} aria-hidden="true">
          <div className={clsx(styles.skeletonBlock, styles.skeletonDetailHead)} />
          <div className={clsx(styles.skeletonBlock, styles.skeletonDetailEntry)} />
          <div className={clsx(styles.skeletonBlock, styles.skeletonDetailEntry)} />
          <div className={clsx(styles.skeletonBlock, styles.skeletonDetailComposer)} />
        </div>
      </div>
    </div>
  );
}
