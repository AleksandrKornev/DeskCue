import { LmStudioRuntimeAdapter } from "./lmStudio/lmStudioRuntimeAdapter.ts";
import { OllamaRuntimeAdapter } from "./ollama/ollamaRuntimeAdapter.ts";
import type {
  LmStudioEndpointResolver,
  LocalLlmAgentRuntimeId,
  LocalLlmFetch,
  LocalLlmRuntimeAdapter,
  LocalLlmRuntimeAdapterRegistry
} from "./types.ts";

export type LocalLlmRuntimeAdapterRegistryOptions = {
  fetch?: LocalLlmFetch;
  lmStudioEndpoint?: LmStudioEndpointResolver;
  ollamaEndpoint?: string;
};

/** One composition boundary for runtime endpoint, wire codec and capability behavior. */
export class HttpLocalLlmRuntimeAdapterRegistry implements LocalLlmRuntimeAdapterRegistry {
  private readonly adapters: Record<LocalLlmAgentRuntimeId, LocalLlmRuntimeAdapter>;

  constructor(options: LocalLlmRuntimeAdapterRegistryOptions = {}) {
    const request = options.fetch ?? fetch;
    const lmStudio = new LmStudioRuntimeAdapter(request, options.lmStudioEndpoint);
    const ollama = new OllamaRuntimeAdapter(request, options.ollamaEndpoint);
    this.adapters = {
      "lm-studio": lmStudio,
      ollama
    };
  }

  get(runtimeId: LocalLlmAgentRuntimeId) {
    return this.adapters[runtimeId];
  }
}

export function resolveLocalLlmRuntimeAdapterRegistry(
  registryOrOptions: LocalLlmRuntimeAdapterRegistry | LocalLlmRuntimeAdapterRegistryOptions
) {
  return "get" in registryOrOptions
    ? registryOrOptions
    : new HttpLocalLlmRuntimeAdapterRegistry(registryOrOptions);
}
