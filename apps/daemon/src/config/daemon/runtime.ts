import { normalize } from "node:path";

import type { AgentDataRoots, RuntimeEndpoints } from "@deskcue/protocol";

import { readOptionalStringEnv } from "../daemonEnv.ts";
import { normalizeEndpoint } from "../daemonSettings.ts";

export type ConfiguredAgentDataRoots = Partial<Record<keyof AgentDataRoots, string>>;
export type ConfiguredRuntimeEndpoints = Partial<Record<keyof RuntimeEndpoints, string>>;

export function readConfiguredAgentDataRoots(): ConfiguredAgentDataRoots {
  const codexHome = readOptionalStringEnv("CODEX_HOME");
  const claudeHome = readOptionalStringEnv("CLAUDE_CONFIG_DIR");
  const lmStudioHome =
    readOptionalStringEnv("LM_STUDIO_HOME") ??
    readOptionalStringEnv("DESKCUE_LM_STUDIO_HOME");

  return {
    ...(codexHome ? { codexHome: normalize(codexHome) } : {}),
    ...(claudeHome ? { claudeHome: normalize(claudeHome) } : {}),
    ...(lmStudioHome ? { lmStudioHome: normalize(lmStudioHome) } : {})
  };
}

export function readConfiguredRuntimeEndpoints(): ConfiguredRuntimeEndpoints {
  const ollamaEndpoint =
    readOptionalStringEnv("DESKCUE_OLLAMA_ENDPOINT") ??
    readOptionalStringEnv("OLLAMA_HOST");
  const lmStudioEndpoint =
    readOptionalStringEnv("DESKCUE_LM_STUDIO_ENDPOINT") ??
    readOptionalStringEnv("LM_STUDIO_ENDPOINT");

  return {
    ...(ollamaEndpoint ? { ollamaEndpoint: normalizeEndpoint(ollamaEndpoint) } : {}),
    ...(lmStudioEndpoint ? { lmStudioEndpoint: normalizeEndpoint(lmStudioEndpoint) } : {})
  };
}

export function buildAgentDataRoots(
  webValue: Partial<Record<keyof AgentDataRoots, string | null>> | undefined,
  configuredValue: ConfiguredAgentDataRoots,
  defaultValue: AgentDataRoots
): AgentDataRoots {
  return {
    codexHome: webValue?.codexHome ?? configuredValue.codexHome ?? defaultValue.codexHome,
    claudeHome: webValue?.claudeHome ?? configuredValue.claudeHome ?? defaultValue.claudeHome,
    lmStudioHome:
      webValue?.lmStudioHome ?? configuredValue.lmStudioHome ?? defaultValue.lmStudioHome
  };
}

export function buildRuntimeEndpoints(
  webValue: Partial<Record<keyof RuntimeEndpoints, string | null>> | undefined,
  configuredValue: ConfiguredRuntimeEndpoints,
  defaultValue: RuntimeEndpoints
): RuntimeEndpoints {
  return {
    ollamaEndpoint:
      webValue?.ollamaEndpoint ?? configuredValue.ollamaEndpoint ?? defaultValue.ollamaEndpoint,
    lmStudioEndpoint:
      webValue?.lmStudioEndpoint ??
      configuredValue.lmStudioEndpoint ??
      defaultValue.lmStudioEndpoint
  };
}

export function buildRuntimeEndpointOverrides(
  webValue: Partial<Record<keyof RuntimeEndpoints, string | null>> | undefined,
  configuredValue: ConfiguredRuntimeEndpoints
): ConfiguredRuntimeEndpoints {
  return {
    ...(webValue?.ollamaEndpoint
      ? { ollamaEndpoint: webValue.ollamaEndpoint }
      : configuredValue.ollamaEndpoint
        ? { ollamaEndpoint: configuredValue.ollamaEndpoint }
        : {}),
    ...(webValue?.lmStudioEndpoint
      ? { lmStudioEndpoint: webValue.lmStudioEndpoint }
      : configuredValue.lmStudioEndpoint
        ? { lmStudioEndpoint: configuredValue.lmStudioEndpoint }
        : {})
  };
}
