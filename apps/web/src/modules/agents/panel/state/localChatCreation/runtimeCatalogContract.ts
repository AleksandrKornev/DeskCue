import type {
  LmStudioInstalledModel,
  LocalLlmRuntimeId,
  OllamaInstalledModel,
  RuntimeSummary
} from "@deskcue/protocol";
import { dashboardApi } from "@api/endpoint/dashboard/endpoints";

type RuntimeCatalogModel = LmStudioInstalledModel | OllamaInstalledModel;
type RuntimeCatalogRequestOptions = { signal: AbortSignal };

export interface LocalChatRuntimeCatalogContract {
  listModels: (
    options: RuntimeCatalogRequestOptions
  ) => Promise<{ models: RuntimeCatalogModel[] }>;
  start: (
    options: RuntimeCatalogRequestOptions
  ) => Promise<{ runtime: RuntimeSummary }>;
}

const LOCAL_CHAT_RUNTIME_CATALOG_CONTRACTS = {
  "lm-studio": {
    listModels: dashboardApi.getLmStudioModels,
    start: dashboardApi.startLmStudioServer
  },
  ollama: {
    listModels: dashboardApi.getOllamaModels,
    start: dashboardApi.startOllamaServer
  }
} satisfies Record<LocalLlmRuntimeId, LocalChatRuntimeCatalogContract>;

export function getLocalChatRuntimeCatalogContract(
  runtimeId: LocalLlmRuntimeId
): LocalChatRuntimeCatalogContract {
  return LOCAL_CHAT_RUNTIME_CATALOG_CONTRACTS[runtimeId];
}
