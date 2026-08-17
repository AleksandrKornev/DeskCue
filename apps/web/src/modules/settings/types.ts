export type SettingsTab = "system" | "access" | "storage" | "notifications";

export type SettingsTabOption = {
  key: SettingsTab;
  label: string;
};

export type WriteTabSearchParam = (nextTab: SettingsTab) => void;
