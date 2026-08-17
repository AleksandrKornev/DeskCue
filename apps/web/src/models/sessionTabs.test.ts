import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getSessionTabLabel,
  getSessionTabsForCapabilities,
  manualCommandNavigationCapabilities,
  resolveAvailableSessionTab,
  restrictSessionNavigationToRuntime,
  sourceChatNavigationCapabilities
} from "./sessionTabs";

describe("session navigation", () => {
  it("keeps source chat navigation focused on review outcomes", () => {
    const tabs = getSessionTabsForCapabilities(sourceChatNavigationCapabilities);

    assert.deepEqual(
      tabs.map((tab) => ({
        key: tab.key,
        label: getSessionTabLabel(tab, sourceChatNavigationCapabilities)
      })),
      [
        { key: "overview", label: "Chat" },
        { key: "diff", label: "Changes" },
        { key: "files", label: "Files" },
        { key: "preview", label: "Preview" }
      ]
    );
  });

  it("keeps command output available for Generic CLI sessions", () => {
    const tabs = getSessionTabsForCapabilities(manualCommandNavigationCapabilities);

    assert.deepEqual(
      tabs.map((tab) => ({
        key: tab.key,
        label: getSessionTabLabel(tab, manualCommandNavigationCapabilities)
      })),
      [
        { key: "overview", label: "Overview" },
        { key: "logs", label: "Output" },
        { key: "diff", label: "Changes" },
        { key: "files", label: "Files" },
        { key: "preview", label: "Preview" }
      ]
    );
  });

  it("falls back to the primary surface for a stale hidden tab", () => {
    const tabs = getSessionTabsForCapabilities(sourceChatNavigationCapabilities);

    assert.equal(resolveAvailableSessionTab("activity", tabs), "overview");
    assert.equal(resolveAvailableSessionTab("logs", tabs), "overview");
    assert.equal(resolveAvailableSessionTab("diff", tabs), "diff");
  });

  it("hides unsupported remote artifact surfaces unless the host opts in", () => {
    const remoteCapabilities = restrictSessionNavigationToRuntime(
      sourceChatNavigationCapabilities,
      {}
    );
    const localCapabilities = restrictSessionNavigationToRuntime(
      sourceChatNavigationCapabilities,
      { files: true, preview: true }
    );

    assert.deepEqual(
      getSessionTabsForCapabilities(remoteCapabilities).map((tab) => tab.key),
      ["overview", "diff"]
    );
    assert.deepEqual(
      getSessionTabsForCapabilities(localCapabilities).map((tab) => tab.key),
      ["overview", "diff", "files", "preview"]
    );
  });
});
