import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AcceptedPairingResponseError,
  fetchPairingEndpoint,
  PairingEndpointError
} from "./pairingTransport";

describe("fetchPairingEndpoint", () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it("returns a parsed successful payload before releasing the request timeout", async () => {
    const payload = {
      accessToken: "access-token",
      daemonUrl: "http://deskcue.test",
      deviceId: "device-1"
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve(payload),
      ok: true,
      status: 200
    }));

    await expect(fetchPairingEndpoint(
      "http://deskcue.test/api/access/pair",
      { code: "valid-code" },
      "Unable to pair this DeskCue client"
    )).resolves.toEqual(payload);
  });

  it("bounds a successful response whose body never completes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => new Promise(() => {}),
      ok: true,
      status: 200
    }));

    const request = fetchPairingEndpoint(
      "http://deskcue.test/api/access/pair",
      { code: "accepted-code" },
      "Unable to pair this DeskCue client"
    );
    const rejection = expect(request).rejects.toBeInstanceOf(AcceptedPairingResponseError);

    await vi.advanceTimersByTimeAsync(1500);
    await rejection;
  });
});
