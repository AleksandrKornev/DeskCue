import { Link } from "react-router";

import type { CloudConnectionStatusResponse } from "@deskcue/protocol";
import { useCloudConnectionStatus } from "@modules/cloudConnection/model/useCloudConnectionStatus";

import styles from "./styles.module.scss";

type CloudAffordancePresentation = {
  compactLabel: string;
  label: string;
  tone: "checking" | "connected" | "local" | "reconnecting" | "revoked" | "unavailable";
};

function cloudAffordancePresentation(
  loading: boolean,
  status: CloudConnectionStatusResponse | null
): CloudAffordancePresentation {
  if (!status && loading) return { compactLabel: "Checking", label: "Checking Cloud", tone: "checking" };

  if (!status) {
    return {
      compactLabel: "Unknown",
      label: "Cloud status unavailable",
      tone: "unavailable"
    };
  }

  if (!status.enabled) return { compactLabel: "Local only", label: "Local only", tone: "local" };
  if (status.connected) return { compactLabel: "Connected", label: "Cloud connected", tone: "connected" };
  if (status.state === "revoked") return { compactLabel: "Revoked", label: "Cloud access revoked", tone: "revoked" };

  return { compactLabel: "Retrying", label: "Cloud reconnecting", tone: "reconnecting" };
}

function statusDotClass(tone: CloudAffordancePresentation["tone"]) {
  if (tone === "connected") return styles.statusDotConnected;
  if (tone === "revoked") return styles.statusDotRevoked;
  if (tone === "reconnecting" || tone === "unavailable") return styles.statusDotReconnecting;

  return styles.statusDot;
}

export function CloudConnectionAffordance() {
  const { error, loading, status } = useCloudConnectionStatus();
  const presentation = cloudAffordancePresentation(loading, error ? null : status);

  return (
    <Link
      aria-label={`DeskCue ${presentation.label.toLowerCase()}; open Connections settings`}
      className={styles.statusLink}
      to="/settings?tab=access"
    >
      <span
        className={statusDotClass(presentation.tone)}
        aria-hidden="true"
      />
      <span className={styles.statusLabel}>{presentation.label}</span>
      <span className={styles.compactStatusLabel}>{presentation.compactLabel}</span>
    </Link>
  );
}
