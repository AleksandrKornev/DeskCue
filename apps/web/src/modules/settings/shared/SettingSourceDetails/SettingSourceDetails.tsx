import clsx from "clsx";

import type { DaemonSettingSourceDetail } from "@deskcue/protocol";

import { formatCurrentSettingValue, formatSettingSource } from "./helpers";
import styles from "./styles.module.scss";

export type SettingSourceDetailsProps<TValue> = {
  source: DaemonSettingSourceDetail<TValue>;
  valueFormatter: (value: TValue | null) => string;
};

export function SettingSourceDetails<TValue>({
  source,
  valueFormatter
}: SettingSourceDetailsProps<TValue>) {
  return (
    <dl className={styles.sourceDetails}>
      <div className={clsx(styles.sourceItem, styles.sourceItemCurrent)}>
        <dt>Current value</dt>
        <dd>
          <span>{formatCurrentSettingValue(source, valueFormatter)}</span>
          <span className={styles.sourceBadge}>{formatSettingSource(source.source)}</span>
        </dd>
      </div>
      <div className={styles.sourceItem}>
        <dt>Env value</dt>
        <dd>{valueFormatter(source.envValue)}</dd>
      </div>
    </dl>
  );
}
