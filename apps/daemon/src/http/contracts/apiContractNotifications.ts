import type { ApiContractRoute } from "./apiContractTypes.ts";

export const notificationApiContract: ApiContractRoute[] = [
  { method: "GET", path: "/api/push/status", successStatuses: [200] },
  { method: "GET", path: "/api/push/vapid-public-key", successStatuses: [200] },
  { method: "GET", path: "/api/push/subscriptions", successStatuses: [200] },
  { method: "POST", path: "/api/push/subscriptions", successStatuses: [201] },
  { method: "DELETE", path: "/api/push/subscriptions/:id", successStatuses: [200] },
  { method: "DELETE", path: "/api/push/subscriptions", successStatuses: [200] },
  { method: "POST", path: "/api/push/test", successStatuses: [200] },
  { method: "GET", path: "/api/notifications/settings", successStatuses: [200] },
  { method: "PATCH", path: "/api/notifications/settings", successStatuses: [200] },
  { method: "POST", path: "/api/notifications/test", successStatuses: [200] },
  {
    method: "POST",
    path: "/api/notifications/telegram/pairing/start",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/notifications/telegram/pairing/resolve",
    successStatuses: [200]
  }
];
