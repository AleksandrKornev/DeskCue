import { notificationsApi } from "@api/endpoint/notifications/endpoints";

const PUSH_CLIENT_ID_STORAGE_KEY = "deskcue.pushClientId";
const PUSH_SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;

export function readPushSupportState() {
  if (typeof navigator === "undefined") {
    return {
      reason: "Push notifications are not available during server-side rendering",
      supported: false
    } as const;
  }

  if (!globalThis.isSecureContext) {
    return {
      code: "insecure_context",
      reason: "Push requires HTTPS or localhost. This LAN HTTP page is not a secure context",
      supported: false
    } as const;
  }

  if (typeof Notification === "undefined") {
    return {
      code: "notifications_unavailable",
      reason: "Notifications are not supported in this browser",
      supported: false
    } as const;
  }

  if (!("serviceWorker" in navigator)) {
    return {
      code: "service_worker_unavailable",
      reason: "Service workers are not supported in this browser",
      supported: false
    } as const;
  }

  if (!("PushManager" in globalThis)) {
    return {
      code: "push_manager_unavailable",
      reason: "PushManager is not supported in this browser",
      supported: false
    } as const;
  }

  return {
    code: "supported",
    reason: null,
    supported: true
  } as const;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  });
}

async function waitForActivePushServiceWorker() {
  await navigator.serviceWorker.register("/service-worker.js", { type: "module" });
  const registration = await withTimeout(
    navigator.serviceWorker.ready,
    PUSH_SERVICE_WORKER_READY_TIMEOUT_MS,
    "DeskCue could not activate its notification service. Reload DeskCue and try again."
  );

  if (!registration.active) {
    throw new Error("DeskCue could not activate its notification service. Reload DeskCue and try again.");
  }

  return registration;
}

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = globalThis.atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}

export function getPushClientId() {
  const existing = localStorage.getItem(PUSH_CLIENT_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const next = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    // This is only a local correlation id for identifying the current browser
    // in DeskCue's subscription list. It is never used as an access credential.
    : `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(PUSH_CLIENT_ID_STORAGE_KEY, next);
  return next;
}

export async function enablePushNotifications(options?: { forceRenew?: boolean }) {
  const support = readPushSupportState();
  if (!support.supported) {
    return {
      data: {
        error: support.reason
      },
      error: support.reason,
      ok: false as const
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      data: {
        error: "Push notification permission was not granted"
      },
      error: "Push notification permission was not granted",
      ok: false as const
    };
  }

  try {
    const [status, registration] = await Promise.all([
      notificationsApi.getPushStatus(),
      waitForActivePushServiceWorker()
    ]);
    const existingSubscription = await registration.pushManager.getSubscription();
    const replaceEndpoint = options?.forceRenew ? existingSubscription?.endpoint : null;
    if (existingSubscription && options?.forceRenew) {
      await existingSubscription.unsubscribe();
    }

    const subscription = !options?.forceRenew && existingSubscription
      ? existingSubscription
      : await registration.pushManager.subscribe({
          applicationServerKey: base64UrlToUint8Array(status.publicKey),
          userVisibleOnly: true
        });

    const subscriptionJson = subscription.toJSON();
    if (!subscriptionJson.keys?.auth || !subscriptionJson.keys.p256dh) {
      throw new Error("Browser push subscription keys are unavailable.");
    }

    return notificationsApi.registerPushSubscription({
      pushClientId: getPushClientId(),
      replaceEndpoint,
      subscription: {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        keys: {
          auth: subscriptionJson.keys.auth,
          p256dh: subscriptionJson.keys.p256dh
        }
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    const message = detail.includes("active Service Worker")
      ? "DeskCue is still activating browser notifications. Try Enable browser push again in a moment."
      : `Unable to enable browser push: ${detail}`;

    return {
      data: { error: message },
      error: message,
      ok: false as const
    };
  }
}

export async function hasCurrentPushSubscription() {
  const support = readPushSupportState();
  if (!support.supported || Notification.permission !== "granted") {
    return false;
  }

  try {
    const registration =
      await navigator.serviceWorker.getRegistration("/service-worker.js") ??
      await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();

    return Boolean(subscription);
  } catch {
    return false;
  }
}

export async function disablePushNotifications() {
  const registration =
    await navigator.serviceWorker.getRegistration("/service-worker.js") ??
    await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  const endpoint = subscription?.endpoint ?? null;

  if (subscription) {
    await subscription.unsubscribe();
  }

  return notificationsApi.removePushSubscription({
    endpoint,
    pushClientId: getPushClientId()
  });
}

export function readPushPermissionState() {
  if (typeof Notification === "undefined") {
    return "unsupported" as const;
  }

  return Notification.permission;
}
