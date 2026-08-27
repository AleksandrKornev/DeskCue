import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadAccessDevices: vi.fn()
}));

vi.mock("@modules/settings/context", () => ({
  useSettingsPageContext: () => ({
    accessStore: {
      loadAccessDevices: mocks.loadAccessDevices
    }
  })
}));

vi.mock("./components/CloudConnectionPanel", () => ({
  CloudConnectionPanel: () => <div>Cloud connection panel</div>
}));

vi.mock("./components/PairDevicesPanel", () => ({
  PairDevicesPanel: () => <div>Pair devices panel</div>
}));

vi.mock("./components/AccessProtectionPanel", () => ({
  AccessProtectionPanel: () => <div>Access protection panel</div>
}));

vi.mock("./components/DeviceAccessPanel", () => ({
  DeviceAccessPanel: () => <div>Device access panel</div>
}));

import { AccessSettingsTab } from "./AccessSettingsTab";

describe("AccessSettingsTab", () => {
  it("places the primary pairing action before the security editor and device management", () => {
    const { container } = render(<AccessSettingsTab />);
    const tabpanel = container.querySelector('[role="tabpanel"]');

    const visiblePanels = [
      screen.getByText("Cloud connection panel"),
      screen.getByText("Pair devices panel"),
      screen.getByText("Access protection panel"),
      screen.getByText("Device access panel")
    ];

    expect(visiblePanels.map((panel) => panel.textContent)).toEqual([
      "Cloud connection panel",
      "Pair devices panel",
      "Access protection panel",
      "Device access panel"
    ]);
    expect(visiblePanels.every((panel, index) =>
      index === 0 || Boolean(
        visiblePanels[index - 1].compareDocumentPosition(panel) &
        Node.DOCUMENT_POSITION_FOLLOWING
      )
    )).toBe(true);
    expect(tabpanel).toHaveAttribute("aria-labelledby", "settings-tab-access");
    expect(tabpanel).toHaveAttribute("id", "settings-panel-access");
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
  });
});
