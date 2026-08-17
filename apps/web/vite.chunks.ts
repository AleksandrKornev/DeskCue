const SOURCE_CHUNKS = [
  ["/src/api/", "api-client"],
  ["/src/components/", "ui-components"],
  ["/src/models/", "web-models"],
  ["/src/modules/dashboard/model/", "dashboard-model"],
  ["/src/modules/settings/", "settings"],
  ["/src/modules/dashboard/shell/", "agent-workspace"],
  ["/src/modules/localLlmChats/", "agent-workspace"],
  ["/src/modules/transcript/", "agent-workspace"],
  ["/src/modules/session/", "agent-workspace"],
  ["/src/modules/agents/", "agent-workspace"]
] as const;

export function getWebManualChunk(id: string): string | undefined {
  const normalizedId = id.replaceAll("\\", "/");
  if (normalizedId.includes("/node_modules/")) {
    if (/\/(react|react-dom|react-router|scheduler)\//.test(normalizedId)) {
      return "react-vendor";
    }
    if (/\/(mobx|mobx-react-lite)\//.test(normalizedId)) {
      return "state-vendor";
    }
    return "vendor";
  }

  for (const [path, chunkName] of SOURCE_CHUNKS) {
    if (normalizedId.includes(path)) {
      return chunkName;
    }
  }
  return undefined;
}
