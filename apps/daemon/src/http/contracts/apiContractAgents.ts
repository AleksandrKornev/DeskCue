import type { ApiContractRoute } from "./apiContractTypes.ts";

export const agentApiContract: ApiContractRoute[] = [
  { method: "GET", path: "/api/agents/sessions", successStatuses: [200] },
  {
    method: "GET",
    path: "/api/agents/sessions/:agentSessionId",
    successStatuses: [200]
  },
  {
    method: "GET",
    path: "/api/agents/sessions/:agentSessionId/transcript-view",
    successStatuses: [200]
  },
  {
    method: "GET",
    path: "/api/agents/sessions/:agentSessionId/transcript-updates",
    successStatuses: [200]
  },
  {
    method: "GET",
    path: "/api/agents/sessions/:agentSessionId/activity-groups/:groupId",
    successStatuses: [200]
  },
  {
    method: "GET",
    path: "/api/agents/sessions/:agentSessionId/changes/:groupId",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/agents/sessions/:agentSessionId/changes/:groupId",
    successStatuses: [200]
  },
  {
    method: "GET",
    path: "/api/agents/sessions/:agentSessionId/transcript-page",
    successStatuses: [200]
  },
  {
    method: "GET",
    path: "/api/agents/sessions/:agentSessionId/transcript-entries",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/agents/sessions/:agentSessionId/transcript-entries",
    successStatuses: [200]
  },
  {
    method: "POST",
    path: "/api/agents/sessions/:agentSessionId/attach",
    successStatuses: [201]
  },
  {
    method: "POST",
    path: "/api/agents/sessions/:agentSessionId/reviewed",
    successStatuses: [200]
  },
  { method: "GET", path: "/api/codex/sessions", successStatuses: [200] },
  { method: "GET", path: "/api/codex/sessions/:sessionId", successStatuses: [200] },
  {
    method: "POST",
    path: "/api/codex/sessions/:sessionId/resume",
    successStatuses: [201]
  }
];
