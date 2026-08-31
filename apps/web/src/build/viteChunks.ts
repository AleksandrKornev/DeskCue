import type { GetManualChunk } from "rollup";

const SOURCE_CHUNKS = [
  ["/src/api/", "api-client"],
  ["/src/assets/images/icon-folder.svg", "shared-icons"],
  ["/src/components/BottomSheet/", "overlays"],
  ["/src/components/Modal/", "overlays"],
  ["/src/components/", "ui-components"],
  ["/src/models/", "web-models"],
  ["/src/modules/dashboard/model/", "dashboard-model"],
  ["/src/modules/dashboard/shell/AddWorkspaceAction/", "workspace-action"],
  ["/src/modules/dashboard/shell/", "agent-workspace"],
  ["/src/modules/localLlmChats/", "agent-workspace"],
  ["/src/modules/transcript/RichTranscriptContent/", "rich-transcript"],
  ["/src/modules/transcript/", "agent-workspace"],
  ["/src/modules/session/tabs/files/", "workspace-files"],
  ["/src/modules/session/", "agent-workspace"],
  ["/src/modules/agents/", "agent-workspace"]
] as const;

const EMBED_SOURCE_CHUNKS = [
  ["/src/api/", "api-client"],
  ["/src/assets/images/icon-folder.svg", "shared-icons"],
  ["/src/components/BottomSheet/", "overlays"],
  ["/src/components/Modal/", "overlays"],
  ["/src/components/", "ui-components"],
  ["/src/models/", "web-models"],
  ["/src/modules/dashboard/model/", "dashboard-model"],
  ["/src/modules/dashboard/shell/store/dashboardNavigationStore", "dashboard-navigation"],
  ["/src/modules/dashboard/shell/", "dashboard-shell"],
  ["/src/modules/session/skeleton/", "session-skeleton"],
  ["/src/modules/localLlmChats/", "session-workspace"],
  ["/src/modules/transcript/", "session-workspace"],
  ["/src/modules/session/", "session-workspace"],
  ["/src/modules/agents/", "session-workspace"]
] as const;

type ManualChunkMeta = Parameters<GetManualChunk>[1];

function collectStaticEntryModules(meta: ManualChunkMeta) {
  const reachable = new Set<string>();
  const pending: string[] = [];

  for (const id of meta.getModuleIds()) {
    if (!meta.getModuleInfo(id)?.isEntry) continue;

    reachable.add(id);
    pending.push(id);
  }

  while (pending.length > 0) {
    const id = pending.pop();

    if (!id) continue;

    for (const importedId of meta.getModuleInfo(id)?.importedIds ?? []) {
      if (reachable.has(importedId)) continue;

      reachable.add(importedId);
      pending.push(importedId);
    }
  }

  return reachable;
}

function findSourceChunk(
  normalizedId: string,
  chunks: ReadonlyArray<readonly [string, string]>
) {
  for (const [path, chunkName] of chunks) {
    if (normalizedId.includes(path)) return chunkName;
  }

  return undefined;
}

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

  return findSourceChunk(normalizedId, SOURCE_CHUNKS);
}

function getWebEmbedFeatureChunk(id: string) {
  const normalizedId = id.replaceAll("\\", "/");

  if (normalizedId.includes("/node_modules/")) return getWebManualChunk(id);

  return findSourceChunk(normalizedId, EMBED_SOURCE_CHUNKS);
}

export function createWebEmbedManualChunk(): GetManualChunk {
  let staticEntryModules: Set<string> | null = null;

  return (id, meta) => {
    staticEntryModules ??= collectStaticEntryModules(meta);

    if (staticEntryModules.has(id)) {
      return meta.getModuleInfo(id)?.isEntry ? undefined : "embed-entry-runtime";
    }

    return getWebEmbedFeatureChunk(id);
  };
}
