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

function settingsDraftValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function mergeSettingsDraftWithBaseline(
  previousDraft: SettingsDraft,
  currentDraft: SettingsDraft,
  nextSettings: DaemonSettingsResponse
): SettingsDraft {
  const nextDraft = createSettingsDraft(nextSettings);

  return {
    agentDataRoots: {
      claudeHome: currentDraft.agentDataRoots.claudeHome === previousDraft.agentDataRoots.claudeHome
        ? nextDraft.agentDataRoots.claudeHome
        : currentDraft.agentDataRoots.claudeHome,
      codexHome: currentDraft.agentDataRoots.codexHome === previousDraft.agentDataRoots.codexHome
        ? nextDraft.agentDataRoots.codexHome
        : currentDraft.agentDataRoots.codexHome,
      lmStudioHome: currentDraft.agentDataRoots.lmStudioHome === previousDraft.agentDataRoots.lmStudioHome
        ? nextDraft.agentDataRoots.lmStudioHome
        : currentDraft.agentDataRoots.lmStudioHome
    },
    allowedOriginsText: currentDraft.allowedOriginsText === previousDraft.allowedOriginsText
      ? nextDraft.allowedOriginsText
      : currentDraft.allowedOriginsText,
    authRequired: currentDraft.authRequired === previousDraft.authRequired
      ? nextDraft.authRequired
      : currentDraft.authRequired,
    pairingHosts: settingsDraftValuesEqual(currentDraft.pairingHosts, previousDraft.pairingHosts)
      ? nextDraft.pairingHosts
      : currentDraft.pairingHosts,
    publicHost: currentDraft.publicHost === previousDraft.publicHost
      ? nextDraft.publicHost
      : currentDraft.publicHost,
    runtimeEndpoints: {
      lmStudioEndpoint:
        currentDraft.runtimeEndpoints.lmStudioEndpoint === previousDraft.runtimeEndpoints.lmStudioEndpoint
          ? nextDraft.runtimeEndpoints.lmStudioEndpoint
          : currentDraft.runtimeEndpoints.lmStudioEndpoint,
      ollamaEndpoint:
        currentDraft.runtimeEndpoints.ollamaEndpoint === previousDraft.runtimeEndpoints.ollamaEndpoint
          ? nextDraft.runtimeEndpoints.ollamaEndpoint
          : currentDraft.runtimeEndpoints.ollamaEndpoint
    },
    storageMaxMb: currentDraft.storageMaxMb === previousDraft.storageMaxMb
      ? nextDraft.storageMaxMb
      : currentDraft.storageMaxMb
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
