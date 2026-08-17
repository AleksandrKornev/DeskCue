import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPairingEndpoint: vi.fn(),
  saveConnectionConfig: vi.fn()
}));

vi.mock("@api/connection/configStorage", () => ({
  getConnectionConfig: () => ({ accessToken: null, daemonUrl: "http://deskcue.test", deviceId: null }),
  saveConnectionConfig: mocks.saveConnectionConfig
}));
vi.mock("@api/connection/pairing/pairingCandidates", () => ({
  buildLocalAccessLinkCandidates: () => [],
  buildPairingDaemonUrlCandidates: () => ["http://deskcue.test"]
}));
vi.mock("@api/connection/pairing/pairingTransport", () => ({
  fetchLocalAccessLink: vi.fn(),
  fetchPairingEndpoint: mocks.fetchPairingEndpoint
}));
vi.mock("@api/connection/pairing/pairingUrlCodes", () => ({
  clearPairingQueryParams: vi.fn(),
  readPairCodeFromPath: () => null,
  readRecoveryCodeFromPath: () => null
}));

describe("pairing request lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.fetchPairingEndpoint.mockReset();
    mocks.saveConnectionConfig.mockReset();
    window.history.replaceState({}, "", "/?pair=temporary-code");
  });

  it("allows a retry after a transient pairing failure", async () => {
    mocks.fetchPairingEndpoint
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ daemonUrl: "http://deskcue.test", deviceId: "device-1" })
      });
    const { prepareConnectionConfig } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow("temporary network failure");
    await expect(prepareConnectionConfig()).resolves.toBeUndefined();

    expect(mocks.fetchPairingEndpoint).toHaveBeenCalledTimes(2);
    expect(mocks.saveConnectionConfig).toHaveBeenCalledWith({
      accessToken: null,
      daemonUrl: "http://deskcue.test",
      deviceId: "device-1"
    });
  });
});
