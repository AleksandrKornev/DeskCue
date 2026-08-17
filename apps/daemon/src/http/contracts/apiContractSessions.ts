import type { ApiContractRoute } from "./apiContractTypes.ts";

export const sessionApiContract: ApiContractRoute[] = [
  { method: "GET", path: "/api/sessions", successStatuses: [200] },
  { method: "GET", path: "/api/sessions/:sessionId", successStatuses: [200] },
  { method: "POST", path: "/api/sessions", successStatuses: [201] },
  { method: "POST", path: "/api/manual-command", successStatuses: [200] },
  { method: "POST", path: "/api/sessions/:sessionId/input", successStatuses: [200] },
  { method: "POST", path: "/api/sessions/:sessionId/interrupt", successStatuses: [200] },
  {
    method: "GET",
    path: "/api/sessions/:sessionId/external-claude-background-stop-capability",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/external-claude-background-stop",
    successStatuses: [200]
  },
  {
    method: "GET",
    path: "/api/sessions/:sessionId/external-force-stop-capability",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/external-force-stop",
    successStatuses: [200]
  },
  {
    method: "GET",
    path: "/api/sessions/:sessionId/external-desktop-interrupt-capability",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/external-desktop-interrupt",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/external-desktop-open",
    successStatuses: [200]
  },
  { method: "POST", path: "/api/sessions/:sessionId/preview", successStatuses: [200] },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/preview/artifacts",
    successStatuses: [201]
  }
];

export const sessionLifecycleApiContract: ApiContractRoute[] = [
  { method: "POST", path: "/api/sessions/:sessionId/refresh-git", successStatuses: [200] },
  { method: "POST", path: "/api/sessions/:sessionId/stop", successStatuses: [200] }
];
