import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessLinkResponse } from "@deskcue/protocol";
import { accessApi } from "@api/endpoint/access/endpoints";

import { accessPairingController } from "./pairingController";
import { AccessPairingStore } from "./pairingStore";
import type { AccessPairingStoreHost } from "./pairingStore";

vi.mock("@api/endpoint/access/endpoints", () => ({
  accessApi: {
    createDevicePairingLink: vi.fn(),
    createRecoveryCode: vi.fn(),
    getDevicePairingLinkStatus: vi.fn()
  }
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn()
  }
}));

const pairingLink: AccessLinkResponse = {
  daemonUrl: "http://127.0.0.1:4100",
  hostSource: "request_host",
  lanReady: true,
  pairCode: "pair-test",
  warnings: [],
  webUrl: "http://127.0.0.1:4100/pair/pair-test"
};

function createHost(): AccessPairingStoreHost {
  return {
    clearStatus: vi.fn(),
    focusPairingHostsEditor: vi.fn(),
    getPairingHosts: vi.fn(() => []),
    refreshAccessDevices: vi.fn(() => Promise.resolve()),
    selectAccessSettingsTab: vi.fn(),
    setError: vi.fn(),
    setSuccess: vi.fn()
  };
}

async function checkPairingLinkStatus(store: AccessPairingStore) {
  await (store as unknown as { checkPairingLinkStatus(): Promise<void> })
    .checkPairingLinkStatus();
}

describe("AccessPairingStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(accessApi.createDevicePairingLink).mockResolvedValue(pairingLink);
    vi.mocked(accessApi.getDevicePairingLinkStatus).mockResolvedValue({ status: "active" });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not refresh access devices when a pairing link is only created", async () => {
    const host = createHost();
    const store = new AccessPairingStore(host);

    await store.createPairingLink();

    expect(host.refreshAccessDevices).not.toHaveBeenCalled();

    store.clearPairingDialog();
  });

  it("refreshes access devices after a pairing link is used", async () => {
    const host = createHost();
    const store = new AccessPairingStore(host);

    vi.mocked(accessApi.getDevicePairingLinkStatus).mockResolvedValue({ status: "used" });
    await store.createPairingLink();
    await vi.waitFor(() => {
      expect(store.pairingLink).toBeNull();
    });

    expect(host.refreshAccessDevices).toHaveBeenCalledTimes(1);
    expect(store.pairingLink).toBeNull();
  });

  it("coalesces overlapping pairing status polls", async () => {
    const host = createHost();
    const store = new AccessPairingStore(host);
    let resolveStatus!: (value: { status: "active" }) => void;
    vi.mocked(accessApi.getDevicePairingLinkStatus).mockReturnValue(new Promise((resolve) => {
      resolveStatus = resolve;
    }));

    await store.createPairingLink();
    await Promise.all([
      checkPairingLinkStatus(store),
      checkPairingLinkStatus(store)
    ]);

    expect(accessApi.getDevicePairingLinkStatus).toHaveBeenCalledTimes(1);
    resolveStatus({ status: "active" });
    await vi.waitFor(() => {
      expect(store.pairingLink).toEqual(pairingLink);
    });
    store.dispose();
  });

  it("ignores a stale status response after the dialog is closed", async () => {
    const host = createHost();
    const store = new AccessPairingStore(host);
    let resolveStatus!: (value: { status: "used" }) => void;
    vi.mocked(accessApi.getDevicePairingLinkStatus).mockReturnValue(new Promise((resolve) => {
      resolveStatus = resolve;
    }));

    await store.createPairingLink();
    store.clearPairingDialog();
    resolveStatus({ status: "used" });
    await Promise.resolve();
    await Promise.resolve();

    expect(host.refreshAccessDevices).not.toHaveBeenCalled();
    expect(store.pairingLink).toBeNull();
  });

  it("stops status polling when disposed", async () => {
    const store = new AccessPairingStore(createHost());

    await store.createPairingLink();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    store.dispose();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start polling when link creation finishes after disposal", async () => {
    const host = createHost();
    const store = new AccessPairingStore(host);
    let resolveLink!: (value: AccessLinkResponse) => void;
    vi.mocked(accessApi.createDevicePairingLink).mockReturnValue(new Promise((resolve) => {
      resolveLink = resolve;
    }));

    const creating = store.createPairingLink();
    await Promise.resolve();
    store.dispose();
    resolveLink(pairingLink);
    await creating;

    expect(store.creatingPairingLink).toBe(false);
    expect(store.pairingLink).toBeNull();
    expect(host.setSuccess).not.toHaveBeenCalled();
    expect(accessApi.getDevicePairingLinkStatus).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a recovery code response that arrives after disposal", async () => {
    const host = createHost();
    let resolveRecovery!: (value: {
      data: { code: string; expiresAt: string };
      ok: true;
    }) => void;
    const createRecoveryCode = vi.fn(() => new Promise<{
      data: { code: string; expiresAt: string };
      ok: true;
    }>((resolve) => {
      resolveRecovery = resolve;
    }));
    const store = new AccessPairingStore(host, {
      ...accessPairingController,
      createRecoveryCode,
      requestConfirmation: vi.fn(() => Promise.resolve(true))
    });

    const creating = store.createRecoveryCode();
    await Promise.resolve();
    store.dispose();
    resolveRecovery({
      data: {
        code: "stale-code",
        expiresAt: "2026-08-06T12:00:00.000Z"
      },
      ok: true
    });
    await creating;

    expect(store.creatingRecoveryCode).toBe(false);
    expect(store.recoveryCode).toBeNull();
    expect(host.setSuccess).not.toHaveBeenCalled();
  });
});
