import type { LocalLlmModelToolCallCapability } from "./types.ts";

export function unavailableToolCapability(
  checkedAt: string
): LocalLlmModelToolCallCapability {
  return {
    checkedAt,
    modelSupportsToolCalls: false,
    source: "runtime_metadata_unavailable"
  };
}

export function toolCapabilityFromMetadata(
  checkedAt: string,
  capabilities: string[] | null,
  supportedSource: "ollama_model_metadata" | "lm_studio_model_metadata",
  supportedCapabilityNames: readonly string[]
): LocalLlmModelToolCallCapability {
  if (!capabilities) return unavailableToolCapability(checkedAt);
  const modelSupportsToolCalls = supportedCapabilityNames.some(
    (name) => capabilities.includes(name)
  );
  return {
    checkedAt,
    modelSupportsToolCalls,
    source: modelSupportsToolCalls
      ? supportedSource
      : "runtime_metadata_does_not_advertise_tools"
  };
}
