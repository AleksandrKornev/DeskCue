import type { GetManualChunk } from "rollup";
import { describe, expect, it } from "vitest";

import { createWebEmbedManualChunk } from "@web/build/viteChunks";

type ManualChunkMeta = Parameters<GetManualChunk>[1];

function createMeta(
  graph: Record<string, { importers: string[]; isEntry?: boolean }>,
  onGetModuleInfo: () => void = () => undefined
) {
  const importedIds = new Map(Object.keys(graph).map((id) => [id, [] as string[]]));

  for (const [id, module] of Object.entries(graph)) {
    for (const importer of module.importers) importedIds.get(importer)?.push(id);
  }

  return {
    getModuleInfo: (id: string) => {
      onGetModuleInfo();

      const module = graph[id];

      if (!module) return null;

      return {
        importedIds: importedIds.get(id) ?? [],
        importers: module.importers,
        isEntry: module.isEntry === true
      };
    },
    getModuleIds: () => Object.keys(graph).values()
  } as ManualChunkMeta;
}

describe("createWebEmbedManualChunk", () => {
  it("keeps the entry static graph separate from dynamically loaded feature chunks", () => {
    const entry = "/src/embed/index.ts";
    const runtime = "/src/runtime/provider.tsx";
    const dynamicDashboard = "/src/modules/dashboard/model/store.ts";
    const meta = createMeta({
      [dynamicDashboard]: { importers: [] },
      [entry]: { importers: [], isEntry: true },
      [runtime]: { importers: [entry] }
    });
    const manualChunk = createWebEmbedManualChunk();

    expect(manualChunk(entry, meta)).toBeUndefined();
    expect(manualChunk(runtime, meta)).toBe("embed-entry-runtime");
    expect(manualChunk(dynamicDashboard, meta)).toBe("dashboard-model");
  });

  it("resolves static reachability through importer cycles", () => {
    const entry = "/src/embed/index.ts";
    const first = "/src/components/first.ts";
    const second = "/src/components/second.ts";
    const meta = createMeta({
      [entry]: { importers: [], isEntry: true },
      [first]: { importers: [second] },
      [second]: { importers: [first, entry] }
    });
    const manualChunk = createWebEmbedManualChunk();

    expect(manualChunk(second, meta)).toBe("embed-entry-runtime");
    expect(manualChunk(first, meta)).toBe("embed-entry-runtime");
  });

  it("classifies a disconnected static chain with linear graph inspection", () => {
    const entry = "/src/embed/index.ts";
    const graph: Record<string, { importers: string[]; isEntry?: boolean }> = {
      [entry]: { importers: [], isEntry: true }
    };

    const moduleCount = 1_500;
    let moduleInfoCalls = 0;

    for (let index = 0; index < moduleCount; index += 1) {
      graph[`/src/modules/dashboard/model/dynamic-${index}.ts`] = {
        importers: index === 0
          ? []
          : [`/src/modules/dashboard/model/dynamic-${index - 1}.ts`]
      };
    }

    const meta = createMeta(graph, () => {
      moduleInfoCalls += 1;
    });
    const manualChunk = createWebEmbedManualChunk();

    for (const id of Object.keys(graph)) manualChunk(id, meta);

    expect(moduleInfoCalls).toBeLessThanOrEqual(moduleCount * 3);
  });
});
