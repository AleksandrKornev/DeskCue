import { describe, expect, it } from "vitest";

import {
  consumeOpenPhonePairingAction,
  resolveSettingsTab,
  settingsTabs
} from "./helpers";

describe("settings connection navigation", () => {
  it("presents local access and optional Cloud under Connections", () => {
    expect(settingsTabs[0]).toEqual({ key: "access", label: "Connections" });
    expect(resolveSettingsTab("access")).toBe("access");
    expect(resolveSettingsTab("security")).toBe("access");
  });

  it("consumes the tray phone-pairing action while preserving unrelated settings state", () => {
    const next = consumeOpenPhonePairingAction(
      new URLSearchParams("tab=storage&action=pair-device&source=tray")
    );

    expect(next?.toString()).toBe("tab=access&source=tray");
  });

  it("ignores unknown settings actions", () => {
    expect(consumeOpenPhonePairingAction(new URLSearchParams("action=unknown"))).toBeNull();
  });
});
