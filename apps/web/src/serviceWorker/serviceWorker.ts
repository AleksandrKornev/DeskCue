import { readSameOriginNotificationUrl } from "./notificationUrl";

type PushPayload = {
  body?: unknown;
  data?: unknown;
  tag?: unknown;
  title?: unknown;
};

type PushEventLike = {
  data?: {
    json: () => unknown;
    text: () => string;
  };
  waitUntil: (operation: Promise<unknown>) => void;
};

type NotificationClickEventLike = {
  notification: {
    close: () => void;
    data?: { url?: unknown };
  };
  waitUntil: (operation: Promise<unknown>) => void;
};

type WindowClientLike = {
  focus?: () => Promise<unknown>;
  navigate?: (url: string) => Promise<WindowClientLike | null>;
  url: string;
};

const scope = globalThis as unknown as {
  addEventListener: {
    (type: "notificationclick", listener: (event: NotificationClickEventLike) => void): void;
    (type: "push", listener: (event: PushEventLike) => void): void;
  };
  clients: {
    matchAll: (options: { includeUncontrolled: boolean; type: "window" }) => Promise<WindowClientLike[]>;
    openWindow: (url: string) => Promise<unknown>;
  };
  location: { origin: string };
  registration: {
    showNotification: (title: string, options: Record<string, unknown>) => Promise<void>;
  };
};

scope.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = typeof payload.title === "string" ? payload.title : "DeskCue";
  event.waitUntil(scope.registration.showNotification(title, {
    badge: "/pwa-icon.svg",
    body: typeof payload.body === "string" ? payload.body : "DeskCue has an update.",
    data: payload.data && typeof payload.data === "object" ? payload.data : {},
    icon: "/pwa-icon.svg",
    renotify: false,
    tag: typeof payload.tag === "string" ? payload.tag : "deskcue-push"
  }));
});

scope.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = readSameOriginNotificationUrl(
    event.notification.data?.url,
    scope.location.origin
  );

  event.waitUntil(scope.clients.matchAll({
    includeUncontrolled: true,
    type: "window"
  }).then(async (clients) => {
    for (const client of clients) {
      if (!client.focus || !client.url.startsWith(scope.location.origin)) continue;
      if (client.navigate) {
        const navigatedClient = await client.navigate(url);
        return navigatedClient?.focus ? navigatedClient.focus() : client.focus();
      }
      return client.focus();
    }
    return scope.clients.openWindow(url);
  }));
});
