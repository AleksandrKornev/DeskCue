import { daemonConfig } from "#config/daemonConfig";

import { streamOllamaChat } from "./ollamaTransport.ts";
import {
  toolCapabilityFromMetadata,
  unavailableToolCapability
} from "../toolCapabilityCodec.ts";
import type {
  LocalLlmFetch,
  LocalLlmRuntimeAdapter,
  LocalLlmRuntimeGenerationInput
} from "../types.ts";
import { asRecord, readStringArray, trimEndpoint } from "../wireValues.ts";

export class OllamaRuntimeAdapter implements LocalLlmRuntimeAdapter {
  readonly runtimeId = "ollama" as const;

  constructor(
    private readonly request: LocalLlmFetch,
    private readonly defaultEndpoint = daemonConfig.runtimeEndpoints.ollamaEndpoint
  ) {}

  async generate(input: LocalLlmRuntimeGenerationInput) {
    await streamOllamaChat({
      ...input,
      endpoint: input.endpoint ?? this.defaultEndpoint,
      fetch: this.request
    });
    return {};
  }

  async probeToolCapability(input: {
    endpoint?: string;
    model: string;
    signal?: AbortSignal;
  }) {
    const checkedAt = new Date().toISOString();
    try {
      const endpoint = input.endpoint ?? this.defaultEndpoint;
      const response = await this.request(`${trimEndpoint(endpoint)}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: input.model }),
        signal: input.signal
      });
      const payload = response.ok ? await response.json() as unknown : null;
      return toolCapabilityFromMetadata(
        checkedAt,
        readStringArray(asRecord(payload)?.capabilities),
        "ollama_model_metadata",
        ["tools"]
      );
    } catch {
      return unavailableToolCapability(checkedAt);
    }
  }
}
