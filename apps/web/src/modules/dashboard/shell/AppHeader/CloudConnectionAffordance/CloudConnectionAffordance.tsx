import { Link } from "react-router";

import { useCloudConnectionStatus } from "@modules/cloudConnection/model/useCloudConnectionStatus";

import styles from "./styles.module.scss";

export function CloudConnectionAffordance() {
  const { status } = useCloudConnectionStatus();
  const isConnected = status?.connected === true;
  const label = isConnected
    ? "Cloud connected"
    : status?.enabled ? "Cloud reconnecting" : "Local only";

  return (
    <Link
      aria-label={`DeskCue ${label.toLowerCase()}; open Connections settings`}
      className={styles.statusLink}
      title={isConnected ? "DeskCue Cloud connected" : "DeskCue Cloud not connected"}
      to="/settings?tab=access"
    >
      <span
        className={isConnected ? styles.statusDotConnected : styles.statusDot}
        aria-hidden="true"
      />
      <span>{label}</span>
    </Link>
  );
}
