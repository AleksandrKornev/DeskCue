import { describe, expect, it } from "vitest";

import { resolveSettingsTab, settingsTabs } from "./helpers";

describe("settings connection navigation", () => {
  it("presents local access and optional Cloud under Connections", () => {
    expect(settingsTabs[0]).toEqual({ key: "access", label: "Connections" });
    expect(resolveSettingsTab("access")).toBe("access");
    expect(resolveSettingsTab("security")).toBe("access");
  });
});
