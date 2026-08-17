import { claudeCodeAdapter, codexAdapter, genericCliAdapter } from "./agentAdapters.ts";
import { lmStudioAdapter, ollamaAdapter } from "./localLlmAdapters.ts";
import type { AdapterCapabilities, AdapterMetadata } from "./types.ts";

export type AdapterMetadataSnapshot = Readonly<Omit<AdapterMetadata, "capabilities">> & {
  readonly capabilities: Readonly<AdapterCapabilities>;
};

export const adapterMetadata: readonly AdapterMetadataSnapshot[] = Object.freeze([
  freezeAdapterMetadata(genericCliAdapter),
  freezeAdapterMetadata(codexAdapter),
  freezeAdapterMetadata(claudeCodeAdapter),
  freezeAdapterMetadata(lmStudioAdapter),
  freezeAdapterMetadata(ollamaAdapter),
  freezeAdapterMetadata(plannedAdapter("opencode", "OpenCode", "agent-cli")),
  freezeAdapterMetadata(plannedAdapter("openhands", "OpenHands", "agent-cli")),
  freezeAdapterMetadata(plannedAdapter("vllm", "vLLM", "llm-runtime")),
  freezeAdapterMetadata(plannedAdapter("litellm", "LiteLLM", "provider-gateway")),
  freezeAdapterMetadata(plannedAdapter("openrouter", "OpenRouter", "provider-gateway"))
]);

export function getAdapterMetadata(adapterId: string) {
  return adapterMetadata.find((adapter) => adapter.id === adapterId) ?? null;
}

function plannedAdapter(
  id: string,
  label: string,
  runtimeKind: AdapterMetadata["runtimeKind"]
): AdapterMetadata {
  const descriptions: Record<typeof runtimeKind, string> = {
    "agent-cli": `${label} adapter is planned. Use Generic CLI until runtime-specific discovery and resume support are implemented.`,
    "llm-runtime": `${label} integration is planned for local runtime status and transcript/provider context, not model hosting inside DeskCue.`,
    "provider-gateway": `${label} gateway integration is planned for configuration visibility only. DeskCue will not store provider credentials by default.`,
    "generic-cli": `${label} integration is planned.`
  };
  return {
    id,
    label,
    description: descriptions[runtimeKind],
    supportLevel: "planned",
    runtimeKind,
    capabilities: plannedCapabilities()
  };
}

function plannedCapabilities(): AdapterCapabilities {
  return { attach: false, discover: false, resume: false, start: false };
}

function freezeAdapterMetadata(adapter: AdapterMetadata): AdapterMetadataSnapshot {
  return Object.freeze({
    id: adapter.id,
    label: adapter.label,
    description: adapter.description,
    supportLevel: adapter.supportLevel,
    runtimeKind: adapter.runtimeKind,
    capabilities: Object.freeze({ ...adapter.capabilities })
  });
}
