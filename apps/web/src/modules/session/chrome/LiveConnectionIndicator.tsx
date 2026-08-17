import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

import { Tooltip } from "@components/Tooltip";

import { getLiveConnectionCopy } from "./helpers";
import styles from "./styles.module.scss";
import type { LiveConnectionIndicatorProps } from "./types";

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
  const accessibleLabel = `${copy.label} ${copy.detail}; ${copy.label} ${copy.compactDetail}`;
  const tooltipLabel = `${copy.label}, ${copy.detail}`;

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
