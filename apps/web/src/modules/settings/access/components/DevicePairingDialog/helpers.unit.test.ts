import { describe, expect, it } from "vitest";

import type { AccessLinkResponse } from "@deskcue/protocol";

import {
  formatPairingHostSourceDescription,
  formatPairingHostSourceLabel
} from "./helpers";

const pairingLink: AccessLinkResponse = {
  daemonUrl: "http://deskcue.test",
  pairCode: "pair-code",
  webUrl: "http://deskcue.test/connect/pair-code"
};

describe("device pairing copy", () => {
  it("uses the visible Connections terminology for saved addresses", () => {
    expect(formatPairingHostSourceLabel(undefined, false, true))
      .toBe("Saved connection address");
    expect(formatPairingHostSourceDescription(pairingLink, false, true))
      .toContain("from Connections");
    expect(formatPairingHostSourceDescription(
      { ...pairingLink, hostSource: "public_host" },
      false,
      false
    )).toContain("from Connections");
    expect(formatPairingHostSourceDescription(
      { ...pairingLink, hostSource: "request_host" },
      false,
      false
    )).not.toContain("Access host");
  });
});
