import type { SettingsTab, SettingsTabOption } from "./types";

export const OPEN_PHONE_PAIRING_ACTION = "pair-device";

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

export function consumeOpenPhonePairingAction(searchParams: URLSearchParams) {
  if (searchParams.get("action") !== OPEN_PHONE_PAIRING_ACTION) return null;

  const next = new URLSearchParams(searchParams);

  next.set("tab", "access");

  next.delete("action");

  return next;
}
