import type { ApiContractRoute } from "./apiContractTypes.ts";

export const cloudApiContract: ApiContractRoute[] = [
  { method: "GET", path: "/api/cloud/connection", successStatuses: [200] },
  { method: "POST", path: "/api/cloud/connection", successStatuses: [201] },
  { method: "PATCH", path: "/api/cloud/connection/permissions", successStatuses: [200] },
  { method: "PATCH", path: "/api/cloud/connection/session-disclosure", successStatuses: [200] },
  { method: "DELETE", path: "/api/cloud/connection", successStatuses: [200] },
  { method: "GET", path: "/api/cloud/enrollment-attempt", successStatuses: [200] },
  { method: "POST", path: "/api/cloud/enrollment-attempts", successStatuses: [201] },
  { method: "DELETE", path: "/api/cloud/enrollment-attempt", successStatuses: [200] }
];
