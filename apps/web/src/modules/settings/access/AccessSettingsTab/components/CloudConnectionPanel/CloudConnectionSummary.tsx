import type { CloudConnectorState } from "@deskcue/protocol";
import CloudIcon from "@assets/images/icon-cloud.svg?react";

import { cloudStatusLabel } from "./cloudConnectionPresentation";
import styles from "./styles.module.scss";

export function CloudConnectionSummary({
  connected,
  hasCloudProfile,
  loading,
  onOpen,
  open,
  state,
  statusAvailable
}: {
  connected: boolean;
  hasCloudProfile: boolean;
  loading: boolean;
  onOpen(): void;
  open: boolean;
  state: CloudConnectorState | undefined;
  statusAvailable: boolean;
}) {
  const statusLabel = cloudStatusLabel(
    connected,
    hasCloudProfile,
    loading,
    statusAvailable,
    state
  );
  const dotClass = !statusAvailable || !hasCloudProfile
    ? styles.statusDot
    : connected
      ? styles.statusDotConnected
      : state === "revoked"
        ? styles.statusDotRevoked
        : styles.statusDotReconnecting;

  return (
    <button
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-describedby="deskcue-cloud-status-summary"
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
          <span className={dotClass} aria-hidden="true" />
          <span id="deskcue-cloud-status-summary">{statusLabel}</span>
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
