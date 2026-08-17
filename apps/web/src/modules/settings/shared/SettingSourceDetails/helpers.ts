import type { DaemonSettingSourceDetail } from "@deskcue/protocol";

export function formatCurrentSettingValue<TValue>(
  source: DaemonSettingSourceDetail<TValue>,
  valueFormatter: (value: TValue | null) => string
) {
  if (source.source === "web" && source.webValue === null) {
    return "Cleared";
  }

  if (
    source.source === "web" &&
    Array.isArray(source.webValue) &&
    source.webValue.length === 0
  ) {
    return "Empty list";
  }

  return valueFormatter(source.value);
}

export function formatSettingSource(source: DaemonSettingSourceDetail<unknown>["source"]) {
  if (source === "web") {
    return "from web";
  }

  if (source === "env") {
    return "from env";
  }

  return "default";
}
