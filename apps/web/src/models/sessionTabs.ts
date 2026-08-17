export type SessionTab = "overview" | "activity" | "logs" | "diff" | "files" | "preview";

export type SessionNavigationCapabilities = {
  conversation: boolean;
  output: boolean;
  changes: boolean;
  files: boolean;
  preview: boolean;
};

export const sessionTabs: Array<{ key: SessionTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "logs", label: "Output" },
  { key: "diff", label: "Changes" },
  { key: "files", label: "Files" },
  { key: "preview", label: "Preview" }
];

export const sourceChatNavigationCapabilities: SessionNavigationCapabilities = {
  conversation: true,
  output: false,
  changes: true,
  files: true,
  preview: true
};

export const manualCommandNavigationCapabilities: SessionNavigationCapabilities = {
  conversation: false,
  output: true,
  changes: true,
  files: true,
  preview: true
};

export function getSessionTabsForCapabilities(
  capabilities: SessionNavigationCapabilities
) {
  return sessionTabs.filter((tab) => {
    switch (tab.key) {
      case "overview":
        return true;
      case "logs":
        return capabilities.output;
      case "diff":
        return capabilities.changes;
      case "files":
        return capabilities.files;
      case "preview":
        return capabilities.preview;
      default:
        return false;
    }
  });
}

export function restrictSessionNavigationToRuntime(
  capabilities: SessionNavigationCapabilities,
  runtimeFeatures: { files?: boolean; preview?: boolean }
): SessionNavigationCapabilities {
  return {
    ...capabilities,
    files: capabilities.files && runtimeFeatures.files === true,
    preview: capabilities.preview && runtimeFeatures.preview === true
  };
}

export function getSessionTabLabel(
  tab: { key: SessionTab; label: string },
  capabilities: SessionNavigationCapabilities
) {
  return tab.key === "overview" && capabilities.conversation
    ? "Chat"
    : tab.label;
}

export function resolveAvailableSessionTab(
  activeTab: SessionTab,
  availableTabs: ReadonlyArray<{ key: SessionTab }>
): SessionTab {
  return availableTabs.some((tab) => tab.key === activeTab)
    ? activeTab
    : "overview";
}
