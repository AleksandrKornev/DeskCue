import type { CloudConnectorState } from "@deskcue/protocol";
import CloudIcon from "@assets/images/icon-cloud.svg?react";

import { cloudStatusLabel } from "./cloudConnectionPresentation";
import styles from "./styles.module.scss";

export function CloudConnectionSummary({
  connected,
  onOpen,
  open,
  state
}: {
  connected: boolean;
  onOpen(): void;
  open: boolean;
  state: CloudConnectorState | undefined;
}) {
  return (
    <button
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label="Open DeskCue Cloud details"
      className={styles.summaryCard}
      onClick={onOpen}
      type="button"
    >
      <span className={styles.cloudIconShell} aria-hidden="true">
        <CloudIcon className={styles.cloudIcon} focusable="false" />
      </span>
      <span className={styles.summaryCopy}>
        <strong>DeskCue Cloud</strong>
        <span className={styles.summaryMeta}>
          <span className={connected ? styles.statusDotConnected : styles.statusDot} aria-hidden="true" />
          <span>{cloudStatusLabel(connected, state)}</span>
          <span className={styles.metaSeparator} aria-hidden="true">·</span>
          <span>Optional remote access</span>
        </span>
      </span>
      <span className={styles.summaryAction} aria-hidden="true">
        <span>Details</span>
        <span className={styles.summaryChevron} />
      </span>
    </button>
  );
}
