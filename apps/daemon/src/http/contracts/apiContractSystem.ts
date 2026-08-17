import type { ApiContractRoute } from "./apiContractTypes.ts";

export const systemBootstrapApiContract: ApiContractRoute[] = [
  { method: "GET", path: "/api/health", successStatuses: [200] },
  { method: "GET", path: "/api/overview", successStatuses: [200] }
];

export const systemManagementApiContract: ApiContractRoute[] = [
  { method: "GET", path: "/api/daemon/logs", successStatuses: [200] },
  { method: "GET", path: "/api/daemon/request-metrics", successStatuses: [200] },
  { method: "GET", path: "/api/daemon/source-agent-index", successStatuses: [200] },
  { method: "GET", path: "/api/maintenance/storage", successStatuses: [200] },
  { method: "POST", path: "/api/maintenance/storage/compact", successStatuses: [200] },
  {
    method: "POST",
    path: "/api/maintenance/storage/migration-backups/clear",
    successStatuses: [200]
  },
  { method: "GET", path: "/api/workspaces", successStatuses: [200] },
  { method: "POST", path: "/api/workspaces", successStatuses: [201] },
  { method: "POST", path: "/api/workspaces/pick", successStatuses: [200, 201] },
  { method: "GET", path: "/api/workspaces/:workspaceId/files", successStatuses: [200] },
  { method: "GET", path: "/api/workspaces/:workspaceId/file", successStatuses: [200] },
  { method: "GET", path: "/api/preview/candidates", successStatuses: [200] },
  { method: "GET", path: "/api/preview/diagnostics", successStatuses: [200] },
  { method: "POST", path: "/api/preview/tickets", successStatuses: [201] }
];

export const runtimeApiContract: ApiContractRoute[] = [
  { method: "GET", path: "/api/runtimes", successStatuses: [200] }
];

export const securityApiContract: ApiContractRoute[] = [
  { method: "GET", path: "/api/security/status", successStatuses: [200] },
  { method: "GET", path: "/api/security/settings", successStatuses: [200] },
  { method: "PATCH", path: "/api/security/settings", successStatuses: [200] },
  { method: "DELETE", path: "/api/security/settings", successStatuses: [200] }
];

export const assetApiContract: ApiContractRoute[] = [
  { method: "GET", path: "/api/assets/file", successStatuses: [200] },
  { method: "GET", path: "/api/assets/local-image", successStatuses: [200] },
  { method: "POST", path: "/api/assets/ticket", successStatuses: [201] },
  { method: "GET", path: "/api/assets/ticket/:ticket", successStatuses: [200] }
];
