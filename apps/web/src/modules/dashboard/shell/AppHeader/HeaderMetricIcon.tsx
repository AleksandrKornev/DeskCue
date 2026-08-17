import MetricChatsIcon from "@assets/images/icon-metric-chats.svg?react";
import MetricManagedIcon from "@assets/images/icon-metric-managed.svg?react";
import MetricRuntimeIcon from "@assets/images/icon-metric-runtime.svg?react";

import type { HeaderMetricIconProps } from "./types";

export function HeaderMetricIcon({ className, kind }: HeaderMetricIconProps) {
  const Icon =
    kind === "threads"
      ? MetricChatsIcon
      : kind === "managed"
        ? MetricManagedIcon
        : MetricRuntimeIcon;

  return <Icon className={className} aria-hidden="true" focusable="false" />;
}
