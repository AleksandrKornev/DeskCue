import clsx from "clsx";

import styles from "@modules/settings/access/AccessSettingsTab/styles.module.scss";

export function PairingHostsDisclosureSkeleton() {
  return (
    <div
      aria-hidden="true"
      className={clsx(styles.addressDisclosure, styles.addressDisclosurePlaceholder)}
    >
      <div className={styles.addressDisclosureSkeletonSummary}>
        <span className={styles.addressDisclosureSummary}>
          <span className={clsx(styles.skeletonLine, styles.skeletonLineShort)} />
          <span className={clsx(styles.skeletonLine, styles.skeletonLineMedium)} />
          <span className={clsx(styles.skeletonLine, styles.skeletonLineWide)} />
        </span>
        <span className={styles.addressDisclosureAction}>
          <span className={clsx(styles.skeletonLine, styles.skeletonLineTiny)} />
          <span className={styles.addressDisclosureChevron} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
