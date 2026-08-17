import { resolveLocalLlmRuntimeAdapterRegistry } from "./transport/localLlmRuntimeAdapterRegistry.ts";
import type { LocalLlmRuntimeAdapterRegistryOptions } from "./transport/localLlmRuntimeAdapterRegistry.ts";
import type {
  LocalLlmAgentTransport,
  LocalLlmRuntimeAdapterRegistry
} from "./transport/types.ts";

export type {
  LmStudioEndpointResolver,
  LocalLlmAgentMessage,
  LocalLlmAgentRuntimeId,
  LocalLlmAgentStreamEvent,
  LocalLlmAgentToolDefinition,
  LocalLlmAgentTransport,
  LocalLlmCompletedToolCall,
  LocalLlmFetch,
  LocalLlmModelToolCallCapability,
  LocalLlmToolCapabilityProbe
} from "./transport/types.ts";
export {
  LmStudioToolCallAccumulator,
  MAX_LM_STUDIO_TOOL_ARGUMENT_BYTES,
  streamLmStudioHistoryReplayAgentChat
} from "./transport/lmStudio/lmStudioHistoryReplayTransport.ts";
export {
  parseOllamaToolCalls,
  streamOllamaAgentChat
} from "./transport/ollama/ollamaTransport.ts";
export { HttpLocalLlmToolCapabilityProbe } from "./transport/toolCapabilityProbe.ts";
export { HttpLocalLlmRuntimeAdapterRegistry } from "./transport/localLlmRuntimeAdapterRegistry.ts";

/** Selects the runtime transport while keeping each wire protocol isolated. */
export class HttpLocalLlmAgentTransport implements LocalLlmAgentTransport {
  private readonly adapters: LocalLlmRuntimeAdapterRegistry;

  constructor(
    registryOrOptions: LocalLlmRuntimeAdapterRegistry | LocalLlmRuntimeAdapterRegistryOptions = {}
  ) {
    this.adapters = resolveLocalLlmRuntimeAdapterRegistry(registryOrOptions);
  }

  async generate(input: Parameters<LocalLlmAgentTransport["generate"]>[0]) {
    await this.adapters.get(input.runtimeId).generate({
      ...input,
      useNativeSession: false
    });
  }
}
