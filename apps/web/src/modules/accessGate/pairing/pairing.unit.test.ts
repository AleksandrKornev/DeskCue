import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearPairingQueryParams: vi.fn(),
  daemonUrls: ["http://deskcue.test"],
  fetchPairingEndpoint: vi.fn(),
  saveConnectionConfig: vi.fn()
}));

vi.mock("@api/connection/configStorage", () => ({
  getConnectionConfig: () => ({ accessToken: null, daemonUrl: "http://deskcue.test", deviceId: null }),
  saveConnectionConfig: mocks.saveConnectionConfig
}));
vi.mock("@api/connection/pairing/pairingCandidates", () => ({
  buildLocalAccessLinkCandidates: () => [],
  buildPairingDaemonUrlCandidates: (queryDaemonUrl: string | null) => queryDaemonUrl
    ? [queryDaemonUrl]
    : mocks.daemonUrls
}));
vi.mock("@api/connection/pairing/pairingTransport", () => ({
  AcceptedPairingResponseError: class AcceptedPairingResponseError extends Error {},
  fetchLocalAccessLink: vi.fn(),
  fetchPairingEndpoint: mocks.fetchPairingEndpoint,
  PairingEndpointError: class PairingEndpointError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  }
}));
vi.mock("@api/connection/pairing/pairingUrlCodes", () => ({
  clearPairingQueryParams: mocks.clearPairingQueryParams,
  readPairCodeFromPath: (pathname: string) => pathname.startsWith("/pair/")
    ? pathname.slice("/pair/".length)
    : null,
  readRecoveryCodeFromPath: (pathname: string) => pathname.startsWith("/recover/")
    ? pathname.slice("/recover/".length)
    : null
}));

describe("pairing request lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.daemonUrls = ["http://deskcue.test"];
    mocks.clearPairingQueryParams.mockReset();

    mocks.clearPairingQueryParams.mockImplementation(() => {
      const url = new URL(window.location.href);

      url.searchParams.delete("deskcueDaemon");
      url.searchParams.delete("daemon");
      url.searchParams.delete("deskcuePair");
      url.searchParams.delete("pair");
      url.searchParams.delete("deskcueRecovery");
      url.searchParams.delete("recovery");
      window.history.replaceState(
        {},
        "",
        `${/^\/(pair|recover)\//.test(url.pathname) ? "/" : url.pathname}${url.search}${url.hash}`
      );
    });

    mocks.fetchPairingEndpoint.mockReset();
    mocks.saveConnectionConfig.mockReset();
    window.history.replaceState({}, "", "/?pair=temporary-code");
  });

  it("scrubs and does not resend a one-time code after an unknown outcome", async () => {
    mocks.fetchPairingEndpoint.mockRejectedValueOnce(new Error("temporary network failure"));
    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow("temporary network failure");
    expect(readConnectionPreparationFailure()).toEqual({
      message: "DeskCue could not confirm whether this pairing request was applied. The original " +
        "code will not be sent again. Check DeskCue access, then create a fresh device link if needed.",
      requestAccepted: false,
      retryOriginal: false,
      title: "Pairing link did not work"
    });

    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/");

    await expect(prepareConnectionConfig()).resolves.toBeUndefined();

    expect(mocks.fetchPairingEndpoint).toHaveBeenCalledTimes(1);
    expect(mocks.saveConnectionConfig).not.toHaveBeenCalled();
  });

  it("points rejected pairing and recovery links to the visible Connections tab", async () => {
    const { PairingEndpointError } = await import("@api/connection/pairing/pairingTransport");

    mocks.fetchPairingEndpoint.mockRejectedValue(
      new PairingEndpointError("rejected", 401)
    );

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow("rejected");
    expect(readConnectionPreparationFailure()?.message).toBe(
      "This pairing link is invalid, expired, or already used. " +
      "Create a fresh device link in Settings → Connections."
    );

    expect(readConnectionPreparationFailure()?.retryOriginal).toBe(false);

    window.history.replaceState({}, "", "/?recovery=temporary-code");
    await expect(prepareConnectionConfig()).rejects.toThrow("rejected");
    expect(readConnectionPreparationFailure()?.message).toBe(
      "This recovery code is invalid, expired, or already used. " +
      "Create a fresh recovery code in Settings → Connections."
    );

    expect(readConnectionPreparationFailure()?.retryOriginal).toBe(false);
  });

  it("does not repeat a rate-limited one-time link automatically", async () => {
    const { PairingEndpointError } = await import("@api/connection/pairing/pairingTransport");

    mocks.fetchPairingEndpoint.mockRejectedValue(
      new PairingEndpointError("rate limited", 429)
    );

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow("rate limited");
    expect(readConnectionPreparationFailure()).toEqual({
      message: "Wait a moment before trying again, then create a fresh link or recovery code.",
      requestAccepted: false,
      retryOriginal: false,
      title: "Too many access attempts"
    });
  });

  it.each([408, 503])("does not retain a temporary HTTP %s pairing code for replay", async (status) => {
    const { PairingEndpointError } = await import("@api/connection/pairing/pairingTransport");

    mocks.fetchPairingEndpoint.mockRejectedValue(
      new PairingEndpointError("temporary service failure", status)
    );

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow("temporary service failure");
    expect(readConnectionPreparationFailure()).toEqual({
      message: "DeskCue could not accept this pairing link. Create a fresh device link in " +
        "Settings → Connections.",
      requestAccepted: false,
      retryOriginal: false,
      title: "Pairing link did not work"
    });
  });

  it("does not retry another client-side pairing rejection", async () => {
    const { PairingEndpointError } = await import("@api/connection/pairing/pairingTransport");

    mocks.fetchPairingEndpoint.mockRejectedValue(
      new PairingEndpointError("unprocessable pairing link", 422)
    );

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow("unprocessable pairing link");
    expect(readConnectionPreparationFailure()).toEqual({
      message: "DeskCue could not accept this pairing link. Create a fresh device link in " +
        "Settings → Connections.",
      requestAccepted: false,
      retryOriginal: false,
      title: "Pairing link did not work"
    });
  });

  it.each([
    "/?pair=pair-code&recovery=recovery-code",
    "/pair/pair-code?recovery=recovery-code",
    "/recover/recovery-code?pair=pair-code",
    "/?deskcuePair=first-pair-code&pair=second-pair-code",
    "/?pair=first-pair-code&pair=second-pair-code",
    "/?deskcuePair=first-pair-code&deskcuePair=second-pair-code",
    "/?recovery=first-recovery-code&recovery=second-recovery-code",
    "/?deskcueRecovery=first-recovery-code&deskcueRecovery=second-recovery-code",
    "/?pair=pair-code&deskcueDaemon=http%3A%2F%2Ffirst.test&daemon=http%3A%2F%2Fsecond.test"
  ])("rejects an ambiguous one-time URL before sending any code: %s", async (url) => {
    window.history.replaceState({}, "", url);

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow(
      "Ambiguous DeskCue pairing or recovery URL"
    );

    expect(readConnectionPreparationFailure()).toEqual({
      message: "This URL contains conflicting pairing, recovery, or DeskCue address values. " +
        "Create and open a single fresh link from Settings → Connections.",
      requestAccepted: false,
      retryOriginal: false,
      title: "One-time link is ambiguous"
    });

    expect(mocks.fetchPairingEndpoint).not.toHaveBeenCalled();
    expect(mocks.saveConnectionConfig).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
  });

  it.each([
    ["/?deskcuePair=&pair=valid-pair-code", "/api/access/pair", "valid-pair-code"],
    ["/pair/valid-pair-code?deskcuePair=", "/api/access/pair", "valid-pair-code"],
    ["/?deskcueRecovery=&recovery=valid-recovery-code", "/api/access/recover", "valid-recovery-code"],
    ["/recover/valid-recovery-code?deskcueRecovery=", "/api/access/recover", "valid-recovery-code"]
  ])("ignores an empty alias before a valid one-time code: %s", async (url, endpoint, code) => {
    window.history.replaceState({}, "", url);
    mocks.fetchPairingEndpoint.mockResolvedValue({
      accessToken: "access-3",
      daemonUrl: "http://deskcue.test",
      deviceId: "device-3"
    });

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).resolves.toBeUndefined();
    expect(readConnectionPreparationFailure()).toBeNull();
    expect(mocks.fetchPairingEndpoint).toHaveBeenCalledTimes(1);
    expect(mocks.fetchPairingEndpoint).toHaveBeenCalledWith(
      expect.stringContaining(endpoint),
      { code },
      expect.any(String)
    );

    expect(mocks.saveConnectionConfig).toHaveBeenCalledWith({
      accessToken: null,
      daemonUrl: "http://deskcue.test",
      deviceId: "device-3"
    });
  });

  it("uses a valid daemon target after an empty higher-priority alias", async () => {
    window.history.replaceState(
      {},
      "",
      "/?deskcueDaemon=&daemon=http%3A%2F%2Fpreferred.test&pair=valid-pair-code"
    );

    mocks.fetchPairingEndpoint.mockResolvedValue({
      accessToken: "access-4",
      daemonUrl: "http://preferred.test",
      deviceId: "device-4"
    });

    const { prepareConnectionConfig } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).resolves.toBeUndefined();
    expect(mocks.fetchPairingEndpoint).toHaveBeenCalledWith(
      "http://preferred.test/api/access/pair",
      { code: "valid-pair-code" },
      expect.any(String)
    );

    expect(mocks.saveConnectionConfig).toHaveBeenCalledWith({
      accessToken: null,
      daemonUrl: "http://preferred.test",
      deviceId: "device-4"
    });
  });

  it("fails closed without sending a code when an explicit daemon target is unsupported", async () => {
    window.history.replaceState(
      {},
      "",
      "/?daemon=ftp%3A%2F%2Finvalid.test&pair=valid-pair-code"
    );

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow(
      "Ambiguous DeskCue pairing or recovery URL"
    );

    expect(readConnectionPreparationFailure()).toEqual({
      message: "This URL contains conflicting pairing, recovery, or DeskCue address values. " +
        "Create and open a single fresh link from Settings → Connections.",
      requestAccepted: false,
      retryOriginal: false,
      title: "One-time link is ambiguous"
    });

    expect(window.location.search).toBe("");
    expect(mocks.fetchPairingEndpoint).not.toHaveBeenCalled();
    expect(mocks.saveConnectionConfig).not.toHaveBeenCalled();
  });

  it("uses the highest-priority daemon failure when every pairing candidate fails", async () => {
    const { PairingEndpointError } = await import("@api/connection/pairing/pairingTransport");

    mocks.daemonUrls = ["http://preferred.test", "http://fallback.test"];
    mocks.fetchPairingEndpoint
      .mockRejectedValueOnce(new PairingEndpointError("preferred rejection", 401))
      .mockRejectedValueOnce(new Error("fallback network failure"));

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow("preferred rejection");
    expect(readConnectionPreparationFailure()).toEqual({
      message: "This pairing link is invalid, expired, or already used. " +
        "Create a fresh device link in Settings → Connections.",
      requestAccepted: false,
      retryOriginal: false,
      title: "Pairing link did not work"
    });

    expect(mocks.fetchPairingEndpoint).toHaveBeenCalledTimes(1);
  });

  it("does not send an outcome-unknown code to a fallback daemon", async () => {
    mocks.daemonUrls = ["http://preferred.test", "http://fallback.test"];
    mocks.fetchPairingEndpoint
      .mockRejectedValueOnce(new Error("preferred network failure"))
      .mockResolvedValueOnce({
        accessToken: "access-2",
        daemonUrl: "http://fallback.test",
        deviceId: "device-2"
      });

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow("preferred network failure");
    expect(readConnectionPreparationFailure()).toEqual({
      message: "DeskCue could not confirm whether this pairing request was applied. The original " +
        "code will not be sent again. Check DeskCue access, then create a fresh device link if needed.",
      requestAccepted: false,
      retryOriginal: false,
      title: "Pairing link did not work"
    });

    expect(mocks.fetchPairingEndpoint).toHaveBeenCalledTimes(1);
    expect(mocks.saveConnectionConfig).not.toHaveBeenCalled();
  });

  it("does not use a successful lower-priority daemon candidate", async () => {
    mocks.daemonUrls = ["http://preferred.test", "http://fallback.test"];
    mocks.fetchPairingEndpoint
      .mockRejectedValueOnce(new Error("preferred network failure"))
      .mockResolvedValueOnce({
        accessToken: "access-2",
        daemonUrl: "http://fallback.test",
        deviceId: "device-2"
      });

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow("preferred network failure");
    expect(readConnectionPreparationFailure()?.retryOriginal).toBe(false);
    expect(mocks.fetchPairingEndpoint).toHaveBeenCalledTimes(1);
    expect(mocks.saveConnectionConfig).not.toHaveBeenCalled();
  });

  it("does not resend an accepted pairing code when browser storage fails", async () => {
    mocks.daemonUrls = ["http://preferred.test", "http://fallback.test"];
    mocks.fetchPairingEndpoint.mockResolvedValue({
      accessToken: "access-5",
      daemonUrl: "http://preferred.test",
      deviceId: "device-5"
    });
    mocks.saveConnectionConfig.mockImplementationOnce(() => {
      throw new DOMException("storage unavailable", "QuotaExceededError");
    });

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow(
      "DeskCue accepted the pair request, but the browser could not save access"
    );

    expect(mocks.fetchPairingEndpoint).toHaveBeenCalledTimes(1);
    expect(readConnectionPreparationFailure()).toEqual({
      message: "DeskCue accepted this pairing request, but the browser could not finish saving " +
        "access. Check DeskCue access. If access is still unavailable, create a fresh device link.",
      requestAccepted: true,
      retryOriginal: false,
      title: "DeskCue access needs checking"
    });
  });

  it("does not resend an accepted recovery code when its success payload cannot be read", async () => {
    window.history.replaceState({}, "", "/?recovery=recovery-code");
    mocks.daemonUrls = ["http://preferred.test", "http://fallback.test"];
    const { AcceptedPairingResponseError } = await import(
      "@api/connection/pairing/pairingTransport"
    );

    mocks.fetchPairingEndpoint.mockRejectedValue(
      new AcceptedPairingResponseError("invalid response payload")
    );

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow(
      "DeskCue accepted the recover request, but the browser could not save access"
    );

    expect(mocks.fetchPairingEndpoint).toHaveBeenCalledTimes(1);
    expect(mocks.saveConnectionConfig).not.toHaveBeenCalled();
    expect(readConnectionPreparationFailure()).toEqual({
      message: "DeskCue accepted this recovery request, but the browser could not finish saving " +
        "access. Check DeskCue access. If access is still unavailable, create a fresh recovery code.",
      requestAccepted: true,
      retryOriginal: false,
      title: "DeskCue access needs checking"
    });
  });

  it.each([
    { accessToken: "access", daemonUrl: "http://preferred.test" },
    { accessToken: "access", daemonUrl: "http://preferred.test", deviceId: "" },
    { accessToken: "access", daemonUrl: "http://preferred.test", deviceId: 42 },
    { accessToken: "", daemonUrl: "http://preferred.test", deviceId: "device" },
    { accessToken: "access", daemonUrl: "ftp://preferred.test", deviceId: "device" },
    { accessToken: "access", daemonUrl: 42, deviceId: "device" }
  ])("treats an invalid accepted payload as terminal without fallback: %j", async (payload) => {
    mocks.daemonUrls = ["http://preferred.test", "http://fallback.test"];
    mocks.fetchPairingEndpoint.mockResolvedValue(payload);

    const {
      prepareConnectionConfig,
      readConnectionPreparationFailure
    } = await import("@api/connection/pairing");

    await expect(prepareConnectionConfig()).rejects.toThrow(
      "DeskCue accepted the pair request, but the browser could not save access"
    );

    expect(mocks.fetchPairingEndpoint).toHaveBeenCalledTimes(1);
    expect(mocks.saveConnectionConfig).not.toHaveBeenCalled();
    expect(readConnectionPreparationFailure()).toMatchObject({
      requestAccepted: true,
      retryOriginal: false,
      title: "DeskCue access needs checking"
    });
  });
});
