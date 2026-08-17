import type { DaemonSettingsResponse } from "@deskcue/protocol";

import type { SettingsDraft } from "./types";

export function createSettingsDraft(settings: DaemonSettingsResponse): SettingsDraft {
  return {
    authRequired: settings.authRequired,
    publicHost: settings.publicHost ?? "",
    pairingHosts: settings.pairingHosts ?? [],
    allowedOriginsText: settings.allowedOrigins.join("\n"),
    storageMaxMb: settings.storageMaxMb,
    agentDataRoots: settings.agentDataRoots,
    runtimeEndpoints: settings.runtimeEndpoints
  };
}

export function parseAllowedOriginsText(value: string) {
  return value
    .split(/[\n,]/)
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function parseListRows(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

export function normalizeAgentDataRootsDraft(value: DaemonSettingsResponse["agentDataRoots"]) {
  return {
    codexHome: value.codexHome.trim() || null,
    claudeHome: value.claudeHome.trim() || null,
    lmStudioHome: value.lmStudioHome.trim() || null
  };
}

export function normalizeRuntimeEndpointsDraft(value: DaemonSettingsResponse["runtimeEndpoints"]) {
  return {
    ollamaEndpoint: value.ollamaEndpoint.trim() || null,
    lmStudioEndpoint: value.lmStudioEndpoint.trim() || null
  };
}
