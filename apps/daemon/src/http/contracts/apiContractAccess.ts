import type { ApiContractRoute } from "./apiContractTypes.ts";

export const accessApiContract: ApiContractRoute[] = [
  { method: "GET", path: "/api/access/link", successStatuses: [200] },
  { method: "GET", path: "/api/access/link/:pairCode/status", successStatuses: [200] },
  { method: "POST", path: "/api/access/pair", successStatuses: [200] },
  { method: "POST", path: "/api/access/recovery-codes", successStatuses: [200] },
  { method: "POST", path: "/api/access/recover", successStatuses: [200] },
  { method: "POST", path: "/api/access/reset", successStatuses: [200] },
  { method: "GET", path: "/api/access/devices", successStatuses: [200] },
  { method: "DELETE", path: "/api/access/devices/current", successStatuses: [200] },
  { method: "DELETE", path: "/api/access/devices/:deviceId", successStatuses: [200] },
  { method: "PATCH", path: "/api/access/devices/:deviceId", successStatuses: [200] },
  { method: "POST", path: "/api/access/devices/revoke-others", successStatuses: [200] }
];
