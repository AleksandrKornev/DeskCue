import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onAuthRequiredChange: vi.fn(),
  settingsMutationPending: false
}));

vi.mock("@modules/settings/context", () => ({
  useSettingsPageContext: () => ({
    accessStore: {
      daemonSettings: {
        settingsFilePath: "daemon-settings.json",
        sources: {
          allowedOrigins: {},
          authRequired: {}
        }
      },
      daemonSettingsDraft: {
        allowedOriginsText: "https://configured.example",
        authRequired: true
      },
      daemonSettingsStatus: null,
      onAllowedOriginsTextChange: vi.fn(),
      onAuthRequiredChange: mocks.onAuthRequiredChange,
      onResetDaemonSettings: vi.fn(),
      onSaveDaemonSettings: vi.fn(),
      resettingDaemonSettings: false,
      savingDaemonSettings: false,
      securityStatus: {
        allowedOrigins: [
          "https://configured.example",
          "https://effective.example"
        ],
        authRequired: true,
        bindHost: "0.0.0.0",
        exposureLevel: "public_exposed",
        riskLevel: "medium",
        summary: "Pairing is required",
        warnings: []
      },
      securityStatusMessage: "",
      settingsMutationPending: mocks.settingsMutationPending
    }
  })
}));

vi.mock("@modules/settings/shared/SettingSourceDetails", () => ({
  SettingSourceDetails: () => null
}));

import { AccessProtectionPanel } from "./AccessProtectionPanel";

describe("AccessProtectionPanel", () => {
  beforeEach(() => {
    mocks.onAuthRequiredChange.mockReset();
    mocks.settingsMutationPending = false;
  });

  it("names effective and configured origin truth separately", () => {
    render(<AccessProtectionPanel />);

    expect(screen.getByText("Effective allowed origins")).toBeInTheDocument();
    expect(screen.getByText("Configured allowed origins")).toBeInTheDocument();
    expect(screen.getByText(/Saved origins only/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Allowed origins$/)).not.toBeInTheDocument();
  });

  it("makes the complete access-token row activate its checkbox", () => {
    render(<AccessProtectionPanel />);

    const row = screen.getByText("Require access token").closest("label");

    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect(mocks.onAuthRequiredChange).toHaveBeenCalledWith(false);
  });

  it("disables shared settings actions while another settings mutation is pending", () => {
    mocks.settingsMutationPending = true;
    render(<AccessProtectionPanel />);

    expect(screen.getByRole("button", { name: "Reset to env" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
  });
});
