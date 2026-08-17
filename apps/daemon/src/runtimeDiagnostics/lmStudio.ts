import path from "node:path";

import type { RuntimeSummary } from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";

import { exists, fetchJson, readJsonFile } from "./shared.ts";

interface LmStudioModelDataEntry {
  lastLoadedTimestamp?: number;
  transitive?: boolean;
}

type LmStudioNativeModel = {
  key?: string;
  loaded_instances?: Array<{ id?: string }>;
  type?: string;
};

type LmStudioLegacyModel = {
  id?: string;
  type?: string;
  state?: string;
};

interface LmStudioModelData {
  json?: [string, LmStudioModelDataEntry][];
}

type LmStudioRuntimeProbes = {
  exists: typeof exists;
  fetchJson: typeof fetchJson;
  readJsonFile: typeof readJsonFile;
};

const defaultProbes: LmStudioRuntimeProbes = {
  exists,
  fetchJson,
  readJsonFile
};

export async function resolveLmStudioEndpoint(
  probes: Pick<LmStudioRuntimeProbes, "readJsonFile"> = defaultProbes
) {
  if (daemonConfig.runtimeEndpointOverrides.lmStudioEndpoint) {
    return daemonConfig.runtimeEndpointOverrides.lmStudioEndpoint;
  }

  const serverConfig = await probes.readJsonFile<{ port?: number }>(
    path.join(daemonConfig.agentDataRoots.lmStudioHome, ".internal", "http-server-config.json")
  );
  return serverConfig?.port
    ? `http://127.0.0.1:${serverConfig.port}`
    : daemonConfig.runtimeEndpoints.lmStudioEndpoint;
}

export async function inspectLmStudioRuntime(
  probes: LmStudioRuntimeProbes = defaultProbes
): Promise<RuntimeSummary> {
  const lmStudioHome = daemonConfig.agentDataRoots.lmStudioHome;
  const lmStudioBin = path.join(
    lmStudioHome,
    "bin",
    process.platform === "win32" ? "lms.exe" : "lms"
  );
  const installed = await probes.exists(lmStudioHome) || await probes.exists(lmStudioBin);
  const endpoint = await resolveLmStudioEndpoint(probes);
  const nativeResponse = await probes.fetchJson<{ models?: LmStudioNativeModel[] }>(`${endpoint}/api/v1/models`);
  const legacyResponse = nativeResponse
    ? null
    : await probes.fetchJson<{ data?: LmStudioLegacyModel[] }>(`${endpoint}/api/v0/models`);
  const openAiResponse = await probes.fetchJson<{ data?: Array<{ id?: string }> }>(`${endpoint}/v1/models`);
  const modelData = await probes.readJsonFile<LmStudioModelData>(
    path.join(lmStudioHome, ".internal", "model-data.json")
  );
  const persistedModels = modelData?.json ?? [];
  const explicitTopLevelModels = persistedModels.filter(([, meta]) => meta.transitive === false);
  const availableModels = explicitTopLevelModels.length > 0
    ? explicitTopLevelModels
    : persistedModels.filter(([, meta]) => meta.transitive !== true);
  const nativeModels = nativeResponse?.models ?? [];
  const legacyModels = legacyResponse?.data ?? [];
  const chatNativeModels = nativeModels.filter((model) => model.type === "llm" || model.type === "vlm");
  const chatLegacyModels = legacyModels.filter((model) => model.type === "llm" || model.type === "vlm");
  const modelIds = chatNativeModels.flatMap((model) => model.key ? [model.key] : [])
    .concat(chatLegacyModels.flatMap((model) => model.id ? [model.id] : []))
    .concat(
      nativeResponse || legacyResponse
        ? []
        : (openAiResponse?.data ?? []).flatMap((model) => model.id ? [model.id] : [])
    );
  const uniqueModelIds = [...new Set(modelIds)];
  const loadedModelCount = nativeResponse
    ? chatNativeModels.reduce((count, model) => count + (model.loaded_instances?.length ?? 0), 0)
    : chatLegacyModels.filter((model) => model.state === "loaded").length;
  const mostRecentModel = availableModels
    .map(([modelId, meta]) => ({
      modelId,
      lastLoadedTimestamp: meta.lastLoadedTimestamp ?? 0
    }))
    .sort((left, right) => right.lastLoadedTimestamp - left.lastLoadedTimestamp)[0]?.modelId ?? null;
  const loadedChatModel = chatNativeModels.find(
    (model) => model.key && (model.loaded_instances?.length ?? 0) > 0
  )?.key ?? chatLegacyModels.find((model) => model.id && model.state === "loaded")?.id ?? null;
  const lastActiveModel = mostRecentModel && uniqueModelIds.includes(mostRecentModel)
    ? mostRecentModel
    : loadedChatModel ?? uniqueModelIds[0] ?? null;
  const runtimeIsReachable = Boolean(nativeResponse || legacyResponse || openAiResponse);
  const modelCount = runtimeIsReachable ? uniqueModelIds.length : availableModels.length;

  return {
    id: "lm-studio",
    label: "LM Studio",
    installed,
    running: runtimeIsReachable,
    endpoint,
    modelCount,
    loadedModelCount,
    lastActiveModel,
    modelStoragePath: lmStudioHome,
    modelStorageSource: "runtime",
    chatCapability: runtimeIsReachable
      ? nativeResponse
        ? "native_session"
        : "history_replay"
      : "unavailable",
    statusText: !installed
      ? "not installed"
      : runtimeIsReachable
        ? `${loadedModelCount} loaded, ${modelCount} local models`
        : "installed, local server is off"
  };
}
