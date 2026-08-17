import clsx from "clsx";

import styles from "@modules/agents/panel/styles.module.scss";

export function SkeletonListCard() {
  return (
    <div className={clsx(styles.listCard, styles.listCardRail, styles.skeletonList)} aria-hidden="true">
      <span className={clsx(styles.skeletonBlock, styles.skeletonListTitle)} />
      <span className={clsx(styles.skeletonBlock, styles.skeletonListMeta)} />
      <span className={clsx(styles.skeletonBlock, styles.skeletonListDate)} />
    </div>
  );
}
