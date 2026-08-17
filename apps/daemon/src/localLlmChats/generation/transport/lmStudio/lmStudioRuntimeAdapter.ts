import { resolveLmStudioEndpoint } from "#runtimeDiagnostics/lmStudio";

import { streamLmStudioHistoryReplayChat } from "./lmStudioHistoryReplayTransport.ts";
import { streamNativeLmStudioChat } from "./lmStudioNativeTransport.ts";
import {
  toolCapabilityFromMetadata,
  unavailableToolCapability
} from "../toolCapabilityCodec.ts";
import type {
  LmStudioEndpointResolver,
  LocalLlmFetch,
  LocalLlmRuntimeAdapter,
  LocalLlmRuntimeGenerationInput
} from "../types.ts";
import { asRecord, readStringArray, trimEndpoint } from "../wireValues.ts";

const LM_STUDIO_TOOL_CAPABILITY_TIMEOUT_MS = 3_000;

export class LmStudioRuntimeAdapter implements LocalLlmRuntimeAdapter {
  readonly runtimeId = "lm-studio" as const;

  constructor(
    private readonly request: LocalLlmFetch,
    private readonly resolveEndpoint: LmStudioEndpointResolver = resolveLmStudioEndpoint
  ) {}

  async generate(input: LocalLlmRuntimeGenerationInput) {
    const endpoint = input.endpoint ?? await this.resolveEndpoint();
    if (input.useNativeSession) {
      return streamNativeLmStudioChat({
        endpoint,
        fetch: this.request,
        model: input.model,
        onDelta: (text) => input.onEvent({ type: "assistant_text_delta", text }),
        previousResponseId: input.previousResponseId,
        prompt: input.messages.at(-1)?.content ?? "",
        signal: input.signal
      });
    }
    await streamLmStudioHistoryReplayChat({
      ...input,
      endpoint,
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
    const timeoutSignal = AbortSignal.timeout(LM_STUDIO_TOOL_CAPABILITY_TIMEOUT_MS);
    const signal = input.signal
      ? AbortSignal.any([input.signal, timeoutSignal])
      : timeoutSignal;
    try {
      const endpoint = input.endpoint ?? await this.resolveEndpoint();
      const response = await this.request(
        `${trimEndpoint(endpoint)}/v1/models/${encodeURIComponent(input.model)}`,
        { signal }
      );
      const payload = response.ok ? await response.json() as unknown : null;
      const metadata = asRecord(payload);
      const capabilities = readStringArray(metadata?.capabilities)
        ?? readStringArray(asRecord(metadata?.metadata)?.capabilities);
      return toolCapabilityFromMetadata(
        checkedAt,
        capabilities,
        "lm_studio_model_metadata",
        ["tools", "tool_calls"]
      );
    } catch {
      return unavailableToolCapability(checkedAt);
    }
  }
}
