import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notificationsApi } from "@api/endpoint/notifications/endpoints";

import { enablePushNotifications } from "./pushNotificationsService";

vi.mock("@api/endpoint/notifications/endpoints", () => ({
  notificationsApi: {
    getPushStatus: vi.fn(),
    registerPushSubscription: vi.fn()
  }
}));

describe("enablePushNotifications", () => {
  beforeEach(() => {
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission: vi.fn().mockResolvedValue("granted")
    });
    vi.stubGlobal("PushManager", class PushManager {});
    Object.defineProperty(globalThis, "isSecureContext", { configurable: true, value: true });
    localStorage.clear();
    vi.mocked(notificationsApi.getPushStatus).mockResolvedValue({
      publicKey: "AQ",
      subscriptionCount: 0,
      supported: true
    });
    vi.mocked(notificationsApi.registerPushSubscription).mockResolvedValue({
      data: {
        subscriptionId: "11111111-1111-4111-8111-111111111111",
        subscriptionCount: 1
      },
      ok: true
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("waits for the service worker activation before subscribing", async () => {
    let resolveReady!: (registration: ServiceWorkerRegistration) => void;
    const ready = new Promise<ServiceWorkerRegistration>((resolve) => {
      resolveReady = resolve;
    });
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: "https://push.example.test/subscription",
      expirationTime: null,
      toJSON: () => ({
        endpoint: "https://push.example.test/subscription",
        expirationTime: null,
        keys: { auth: "auth-key", p256dh: "public-key" }
      })
    });
    const registration = {
      active: { state: "activated" },
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe
      }
    } as unknown as ServiceWorkerRegistration;

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready,
        register: vi.fn().mockResolvedValue(registration)
      }
    });

    const pending = enablePushNotifications();
    await Promise.resolve();
    await Promise.resolve();

    expect(subscribe).not.toHaveBeenCalled();

    resolveReady(registration);

    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
