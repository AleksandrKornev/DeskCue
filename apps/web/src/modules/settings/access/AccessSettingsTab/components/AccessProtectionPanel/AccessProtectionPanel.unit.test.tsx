import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
      onAuthRequiredChange: vi.fn(),
      onResetDaemonSettings: vi.fn(),
      onSaveDaemonSettings: vi.fn(),
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
      securityStatusMessage: ""
    }
  })
}));

vi.mock("@modules/settings/shared/SettingSourceDetails", () => ({
  SettingSourceDetails: () => null
}));

import { AccessProtectionPanel } from "./AccessProtectionPanel";

describe("AccessProtectionPanel", () => {
  it("names effective and configured origin truth separately", () => {
    render(<AccessProtectionPanel />);

    expect(screen.getByText("Effective allowed origins")).toBeInTheDocument();
    expect(screen.getByText("Configured allowed origins")).toBeInTheDocument();
    expect(screen.getByText(/Saved origins only/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Allowed origins$/)).not.toBeInTheDocument();
  });
});
