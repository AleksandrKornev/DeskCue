import { beforeEach, describe, expect, it } from "vitest";

import { invalidateConnectionConfigCache } from "@api/connection/configStorage";
import { normalizeDaemonUrl } from "@api/connection/configUrls";

import { buildPairingDaemonUrlCandidates } from "./pairingCandidates";

describe("pairing daemon candidates", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    invalidateConnectionConfigCache();
  });

  it("uses only the explicit daemon target for a one-time code", () => {
    const queryDaemonUrl = "http://query.test:4100";
    const storedDaemonUrl = "http://stored.test:4100";

    localStorage.setItem("deskcue.daemonUrl", storedDaemonUrl);

    window.history.replaceState(
      null,
      "",
      `/?daemon=${encodeURIComponent(queryDaemonUrl)}&pair=pair-code`
    );

    expect(buildPairingDaemonUrlCandidates(queryDaemonUrl)).toEqual([queryDaemonUrl]);

    expect(localStorage.getItem("deskcue.daemonUrl")).toBe(storedDaemonUrl);
  });

  it("does not send a targetless one-time code to a stored non-loopback daemon", () => {
    const sameOriginDaemonUrl = normalizeDaemonUrl(window.location.origin);

    localStorage.setItem("deskcue.daemonUrl", "http://stored.test:4100");
    invalidateConnectionConfigCache();

    expect(buildPairingDaemonUrlCandidates(null)).toEqual([sameOriginDaemonUrl]);
  });
});
