import type { SettingsTab, SettingsTabOption } from "./types";

export const settingsTabs: SettingsTabOption[] = [
  {
    key: "access",
    label: "Connections"
  },
  {
    key: "storage",
    label: "Storage"
  },
  {
    key: "notifications",
    label: "Notifications"
  },
  {
    key: "system",
    label: "System"
  }
];

export function isSettingsTab(value: string | null): value is SettingsTab {
  return settingsTabs.some((tab) => tab.key === value);
}

export function resolveSettingsTab(value: string | null): SettingsTab | null {
  if (value === "security") {
    return "access";
  }

  if (value === "logs") {
    return "storage";
  }

  return isSettingsTab(value) ? value : null;
}
