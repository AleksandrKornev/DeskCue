import clsx from "clsx";

import styles from "@modules/settings/access/AccessSettingsTab/styles.module.scss";

export function AccessProtectionSkeleton() {
  return (
    <>
      <dl
        aria-hidden="true"
        className={clsx(styles.securityGrid, styles.accessSkeletonGrid)}
      >
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index}>
            <dt className={clsx(styles.skeletonLine, styles.skeletonLineShort)} />
            <dd className={styles.skeletonLine} />
          </div>
        ))}
      </dl>
      <div
        aria-hidden="true"
        className={styles.accessSkeletonWarning}
      >
        <span className={clsx(styles.skeletonLine, styles.skeletonLineWide)} />
      </div>
      <div
        aria-hidden="true"
        className={clsx(styles.settingsForm, styles.accessSkeletonForm)}
      >
        <div className={styles.formHeader}>
          <div>
            <span className={clsx(styles.skeletonLine, styles.skeletonLineMedium)} />
            <span className={styles.skeletonLine} />
          </div>
          <span className={clsx(styles.skeletonLine, styles.skeletonLineWide)} />
        </div>
        <div className={clsx(styles.toggleRow, styles.accessSkeletonToggle)}>
          <span className={clsx(styles.skeletonLine, styles.skeletonLineMedium)} />
        </div>
        <div className={styles.fieldLabel}>
          <span className={clsx(styles.skeletonLine, styles.skeletonLineShort)} />
          <span className={clsx(styles.field, styles.textArea, styles.accessSkeletonField)} />
          <span className={clsx(styles.skeletonLine, styles.skeletonLineMedium)} />
        </div>
      </div>
    </>
  );
}
