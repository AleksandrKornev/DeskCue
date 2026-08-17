import type { DaemonSettingsResponse, SecurityStatusResponse } from "@deskcue/protocol";

export function formatExposureLevel(exposureLevel: SecurityStatusResponse["exposureLevel"]) {
  if (exposureLevel === "local_only") {
    return "Local only";
  }

  if (exposureLevel === "lan_exposed") {
    return "LAN exposed";
  }

  return "Public exposed";
}

export function formatAgentDataRootsValue(value: DaemonSettingsResponse["agentDataRoots"] | null) {
  if (!value) {
    return "Not configured";
  }

  return `Codex: ${value.codexHome}; Claude Code: ${value.claudeHome}; LM Studio: ${value.lmStudioHome}`;
}

export function formatRuntimeEndpointsValue(
  value: DaemonSettingsResponse["runtimeEndpoints"] | null
) {
  if (!value) {
    return "Not configured";
  }

  return `Ollama: ${value.ollamaEndpoint}; LM Studio: ${value.lmStudioEndpoint}`;
}
