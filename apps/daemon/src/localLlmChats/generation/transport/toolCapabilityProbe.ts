import { resolveLocalLlmRuntimeAdapterRegistry } from "./localLlmRuntimeAdapterRegistry.ts";
import type { LocalLlmRuntimeAdapterRegistryOptions } from "./localLlmRuntimeAdapterRegistry.ts";
import type {
  LocalLlmRuntimeAdapterRegistry,
  LocalLlmToolCapabilityProbe
} from "./types.ts";

/** Reads explicit runtime metadata and never guesses capability from a model name. */
export class HttpLocalLlmToolCapabilityProbe implements LocalLlmToolCapabilityProbe {
  private readonly adapters: LocalLlmRuntimeAdapterRegistry;

  constructor(
    registryOrOptions: LocalLlmRuntimeAdapterRegistry | LocalLlmRuntimeAdapterRegistryOptions = {}
  ) {
    this.adapters = resolveLocalLlmRuntimeAdapterRegistry(registryOrOptions);
  }

  async probe(input: Parameters<LocalLlmToolCapabilityProbe["probe"]>[0]) {
    return this.adapters.get(input.runtimeId).probeToolCapability(input);
  }
}
