import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

import { Tooltip } from "@components/Tooltip";

import {
  getLiveConnectionCopy,
  getLiveConnectionTooltipLabel
} from "./helpers";
import styles from "./styles.module.scss";
import type { LiveConnectionIndicatorProps } from "./types";

function getLiveConnectionAnnouncement(
  status: LiveConnectionIndicatorProps["connection"]["status"]
) {
  switch (status) {
    case "live":
      return "Live updates connected";
    case "connecting":
      return "Connecting live updates";
    case "reconnecting":
      return "Live updates reconnecting";
    case "offline":
      return "Live updates offline";
  }
}

export function LiveConnectionIndicator({
  className,
  connection
}: LiveConnectionIndicatorProps) {
  const [now, setNow] = useState(() => Date.now());
  const shouldTick = Boolean(connection.lastSyncedAt);

  useEffect(() => {
    if (!shouldTick) return;

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [shouldTick]);

  const copy = useMemo(
    () => getLiveConnectionCopy(connection, now),
    [connection, now]
  );

  const tooltipLabel = getLiveConnectionTooltipLabel(copy);
  const accessibleLabel = getLiveConnectionAnnouncement(connection.status);

  return (
    <Tooltip
      ariaLabel={accessibleLabel}
      className={clsx(
        styles.liveConnection,
        connection.status === "live" && styles.liveConnectionLive,
        connection.status === "connecting" && styles.liveConnectionConnecting,
        connection.status === "reconnecting" && styles.liveConnectionReconnecting,
        connection.status === "offline" && styles.liveConnectionOffline,
        className
      )}
      fitContent
      tapToOpen
      value={tooltipLabel}
    >
      <span aria-hidden="true" className={styles.liveConnectionDot} />
      <span className={styles.liveConnectionLabel}>{copy.label}</span>
      <span className={styles.liveConnectionDetail}>{copy.detail}</span>
      <span className={styles.liveConnectionCompactDetail}>{copy.compactDetail}</span>
    </Tooltip>
  );
}

export function LiveConnectionAnnouncement({ connection }: LiveConnectionIndicatorProps) {
  return (
    <span aria-atomic="true" aria-live="polite" className={styles.srOnly} role="status">
      {getLiveConnectionAnnouncement(connection.status)}
    </span>
  );
}
