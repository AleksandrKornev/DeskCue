import { beforeEach, describe, expect, it, vi } from "vitest";

import { notificationsApi } from "@api/endpoint/notifications/endpoints";

import { enablePushNotifications } from "./pushNotificationsService";
import { NotificationPushStore } from "./pushStore";

vi.mock("@api/endpoint/notifications/endpoints", () => ({
  notificationsApi: {
    getPushStatus: vi.fn(),
    listPushSubscriptions: vi.fn(),
    removePushSubscriptionById: vi.fn()
  }
}));

vi.mock("./pushNotificationsService", () => ({
  disablePushNotifications: vi.fn(),
  enablePushNotifications: vi.fn(),
  getPushClientId: vi.fn(() => "current-browser"),
  readPushPermissionState: vi.fn(() => "granted"),
  readPushSupportState: vi.fn(() => ({
    code: "supported",
    reason: null,
    supported: true
  }))
}));

const initialSubscriptions = [
  {
    createdAt: "2026-08-04T10:00:00.000Z",
    current: true,
    id: "11111111-1111-4111-8111-111111111111",
    label: "Chrome on this computer",
    lastDeliveredAt: "2026-08-04T10:01:00.000Z",
    updatedAt: "2026-08-04T10:01:00.000Z"
  },
  {
    createdAt: "2026-08-03T10:00:00.000Z",
    current: false,
    id: "22222222-2222-4222-8222-222222222222",
    label: "Chrome on phone",
    lastDeliveredAt: null,
    updatedAt: "2026-08-03T10:00:00.000Z"
  }
];

describe("NotificationPushStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notificationsApi.getPushStatus).mockResolvedValue({
      publicKey: "public-key",
      subscriptionCount: initialSubscriptions.length,
      supported: true
    });
    vi.mocked(notificationsApi.listPushSubscriptions).mockResolvedValue({
      subscriptionCount: initialSubscriptions.length,
      subscriptions: initialSubscriptions
    });
  });

  it("loads only safe browser summaries and separates the current browser", async () => {
    const store = new NotificationPushStore();

    await store.loadPushStatus();

    expect(notificationsApi.listPushSubscriptions).toHaveBeenCalledWith("current-browser");
    expect(store.currentPushSubscribed).toBe(true);
    expect(store.otherPushSubscriptions).toEqual([initialSubscriptions[1]]);
    expect(JSON.stringify(store.pushSubscriptions)).not.toContain("endpoint");
    expect(JSON.stringify(store.pushSubscriptions)).not.toContain("pushClientId");
  });

  it("coalesces concurrent status loads into one request", async () => {
    let resolveSubscriptions!: (value: {
      subscriptionCount: number;
      subscriptions: typeof initialSubscriptions;
    }) => void;
    vi.mocked(notificationsApi.listPushSubscriptions).mockReturnValue(new Promise((resolve) => {
      resolveSubscriptions = resolve;
    }));
    const store = new NotificationPushStore();

    const firstLoad = store.loadPushStatus();
    const secondLoad = store.loadPushStatus();

    expect(store.loadingPushStatus).toBe(true);
    expect(notificationsApi.getPushStatus).toHaveBeenCalledTimes(1);
    expect(notificationsApi.listPushSubscriptions).toHaveBeenCalledTimes(1);

    resolveSubscriptions({
      subscriptionCount: initialSubscriptions.length,
      subscriptions: initialSubscriptions
    });
    await Promise.all([firstLoad, secondLoad]);

    expect(store.loadingPushStatus).toBe(false);
    expect(store.currentPushSubscribed).toBe(true);
  });

  it("removes only the selected other browser and refreshes the list", async () => {
    const store = new NotificationPushStore();
    await store.loadPushStatus();
    vi.mocked(notificationsApi.removePushSubscriptionById).mockResolvedValue({
      data: {
        removedCount: 1,
        subscriptionCount: 1
      },
      ok: true
    });
    vi.mocked(notificationsApi.listPushSubscriptions).mockResolvedValue({
      subscriptionCount: 1,
      subscriptions: [initialSubscriptions[0]]
    });

    await store.removeOtherPushSubscription(initialSubscriptions[1].id);

    expect(notificationsApi.removePushSubscriptionById)
      .toHaveBeenCalledWith(initialSubscriptions[1].id);
    expect(store.otherPushSubscriptions).toEqual([]);
    expect(store.pushStatus).toBe("Push notifications stopped");
  });

  it("forces a fresh status read after enabling while the initial load is still active", async () => {
    let resolveInitial!: (value: {
      subscriptionCount: number;
      subscriptions: typeof initialSubscriptions;
    }) => void;
    vi.mocked(notificationsApi.listPushSubscriptions)
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveInitial = resolve;
      }))
      .mockResolvedValueOnce({
        subscriptionCount: initialSubscriptions.length,
        subscriptions: initialSubscriptions
      });
    vi.mocked(enablePushNotifications).mockResolvedValue({
      data: {
        subscriptionCount: initialSubscriptions.length,
        subscriptionId: initialSubscriptions[0].id
      },
      ok: true
    });
    const store = new NotificationPushStore();

    const initialLoad = store.loadPushStatus();
    const enabling = store.enablePush();
    resolveInitial({
      subscriptionCount: 0,
      subscriptions: []
    });
    await Promise.all([initialLoad, enabling]);

    expect(notificationsApi.listPushSubscriptions).toHaveBeenCalledTimes(2);
    expect(store.currentPushSubscribed).toBe(true);
  });
});
