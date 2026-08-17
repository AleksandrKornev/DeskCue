import clsx from "clsx";

import styles from "@modules/agents/panel/styles.module.scss";

export function AgentSessionsListSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }, (_, index) => (
        <div
          aria-hidden="true"
          className={clsx(styles.listCard, styles.listCardRail, styles.skeletonBlock)}
          key={index}
        >
          <span className={clsx(styles.skeletonPill, styles.skeletonListTitle)} />
          <span className={clsx(styles.skeletonPill, styles.skeletonListMeta)} />
          <span className={clsx(styles.skeletonPill, styles.skeletonListDate)} />
        </div>
      ))}
    </>
  );
}
