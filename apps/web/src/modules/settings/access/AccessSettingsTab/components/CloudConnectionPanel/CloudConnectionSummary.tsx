import type { CloudConnectorState } from "@deskcue/protocol";
import CloudIcon from "@assets/images/icon-cloud.svg?react";

import styles from "./styles.module.scss";

interface CloudConnectionSummaryProps {
  connected: boolean;
  onOpen(): void;
  open: boolean;
  state: CloudConnectorState | undefined;
}

function cloudStatusLabel(
  connected: boolean,
  state: CloudConnectorState | undefined
): string {
  if (connected) return "Cloud connected";
  if (state === "connecting") return "Connecting";
  if (state === "degraded") return "Cloud degraded";
  if (state === "revoked") return "Cloud access revoked";

  return "Local only";
}

export function CloudConnectionSummary({
  connected,
  onOpen,
  open,
  state
}: CloudConnectionSummaryProps) {
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
