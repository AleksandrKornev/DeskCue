import type {
  LmStudioModelsResponse,
  LmStudioPrepareResponse,
  LmStudioServerStartResponse,
  OllamaModelsResponse,
  OllamaServerStartResponse,
  OverviewResponse,
  RuntimeSummary
} from "@deskcue/protocol";
import { getJson, postJson } from "@api/transport/requests";

export type { LmStudioInstalledModel } from "@deskcue/protocol";

const OVERVIEW_SESSION_LIMIT = 16;

export const dashboardApi = {
  getOverview() {
    return getJson<OverviewResponse>(
      `/api/overview?sessionLimit=${OVERVIEW_SESSION_LIMIT}`,
      "Failed to load overview"
    );
  },

  getRuntimes() {
    return getJson<RuntimeSummary[]>("/api/runtimes", "Failed to load runtimes");
  },

  startLmStudioServer(options?: { signal?: AbortSignal }) {
    return postJson<LmStudioServerStartResponse>(
      "/api/runtimes/lm-studio/server/start",
      {},
      "Failed to start LM Studio Local Server",
      { signal: options?.signal, timeoutMs: 20_000 }
    );
  },
  startOllamaServer(options?: { signal?: AbortSignal }) {
    return postJson<OllamaServerStartResponse>(
      "/api/runtimes/ollama/server/start",
      {},
      "Failed to start Ollama",
      { signal: options?.signal, timeoutMs: 20_000 }
    );
  },
  getLmStudioModels(options?: { signal?: AbortSignal }) {
    return getJson<LmStudioModelsResponse>(
      "/api/runtimes/lm-studio/models",
      "Failed to load local LM Studio models",
      options
    );
  },
  getOllamaModels(options?: { signal?: AbortSignal }) {
    return getJson<OllamaModelsResponse>(
      "/api/runtimes/ollama/models",
      "Failed to load local Ollama models",
      options
    );
  },
  prepareLmStudioModel(model: string) {
    return postJson<LmStudioPrepareResponse>(
      "/api/runtimes/lm-studio/prepare",
      { model },
      "Failed to prepare LM Studio",
      { timeoutMs: 125_000 }
    );
  }
};
