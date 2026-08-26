import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchPairingEndpoint,
  PairingEndpointError
} from "./pairingTransport";

describe("fetchPairingEndpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves a bounded daemon rejection reason and status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: "Pairing code is invalid or expired." }),
      ok: false,
      status: 401
    }));

    const request = fetchPairingEndpoint(
      "http://deskcue.test/api/access/pair",
      { code: "invalid-code" },
      "Unable to pair this DeskCue client"
    );

    await expect(request).rejects.toEqual(expect.objectContaining<PairingEndpointError>({
      message: "Pairing code is invalid or expired.",
      name: "PairingEndpointError",
      status: 401
    }));
  });
});
