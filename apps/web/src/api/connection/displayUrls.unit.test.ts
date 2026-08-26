import { beforeEach, describe, expect, it } from "vitest";

import { invalidateConnectionConfigCache } from "./configStorage";
import {
  buildCurrentDaemonAccessSettingsUrl,
  readCurrentDaemonWebOrigin
} from "./displayUrls";

describe("connection display URLs", () => {
  beforeEach(() => {
    localStorage.clear();
    invalidateConnectionConfigCache();
  });

  it("uses the current loopback origin for an embedded production dashboard", () => {
    const location = new URL("http://127.0.0.1:4320/settings") as unknown as Location;

    expect(readCurrentDaemonWebOrigin(location, false)).toBe("http://127.0.0.1:4320");
    expect(buildCurrentDaemonAccessSettingsUrl(location, false)).toBe(
      "http://127.0.0.1:4320/settings?tab=access"
    );
  });

  it("keeps the default daemon origin for the loopback Vite development page", () => {
    const location = new URL("http://127.0.0.1:4173/settings") as unknown as Location;

    expect(readCurrentDaemonWebOrigin(location, true)).toBe("http://127.0.0.1:4100");
  });
});
