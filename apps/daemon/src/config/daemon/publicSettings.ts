import type {
  AgentDataRoots,
  DaemonSettingsResponse,
  DaemonSettingSourceDetail,
  RuntimeEndpoints,
  UpdateDaemonSettingsInput
} from "@deskcue/protocol";

import type { DaemonConfigConfiguredValues, DaemonConfigDefaults } from "./environment.ts";
import { buildAllowedOrigins } from "./origins.ts";
import {
  buildAgentDataRoots,
  buildRuntimeEndpointOverrides,
  buildRuntimeEndpoints
} from "./runtime.ts";
import {
  normalizeAgentDataRoots,
  normalizeAllowedOrigins,
  normalizePairingHosts,
  normalizePublicHost,
  normalizeRuntimeEndpoints
} from "../daemonSettings.ts";
import type { StoredDaemonSettings } from "../daemonSettings.ts";
import { removeStoredDaemonSettings, writeStoredDaemonSettings } from "../daemonSettingsStore.ts";

type MutableDaemonSettingsConfig = {
  agentDataRoots: AgentDataRoots;
  allowedOrigins: string[];
  authRequired: boolean;
  bindHost: string;
  configuredAllowedOrigins: string[];
  daemonPort: number;
  pairingHosts: string[];
  publicHost: string | null;
  runtimeEndpointOverrides: Partial<Record<keyof RuntimeEndpoints, string>>;
  runtimeEndpoints: RuntimeEndpoints;
  settingsFilePath: string;
  storageMaxBytes: number;
};

type DaemonSettingsControllerOptions = {
  config: MutableDaemonSettingsConfig;
  configured: DaemonConfigConfiguredValues;
  defaults: DaemonConfigDefaults;
  storedSettings: StoredDaemonSettings;
};

export type DaemonSettingsController = {
  read(): DaemonSettingsResponse;
  reset(): DaemonSettingsResponse;
  update(input: UpdateDaemonSettingsInput): DaemonSettingsResponse;
};

function buildSettingSourceDetail<TValue>(
  value: TValue,
  webValue: TValue | undefined,
  envValue: TValue | null,
  defaultValue: TValue
): DaemonSettingSourceDetail<TValue> {
  return {
    source: webValue !== undefined ? "web" : envValue !== null ? "env" : "default",
    value,
    webValue: webValue ?? null,
    envValue,
    defaultValue
  };
}

function refreshAllowedOrigins(config: MutableDaemonSettingsConfig) {
  config.allowedOrigins = buildAllowedOrigins(
    config.configuredAllowedOrigins,
    config.publicHost,
    config.pairingHosts,
    config.daemonPort
  );
}

function hasKeys(value: object) {
  return Object.keys(value).length > 0;
}

export function createDaemonSettingsController(
  options: DaemonSettingsControllerOptions
): DaemonSettingsController {
  let runtimeStoredSettings: StoredDaemonSettings = {
    ...options.storedSettings
  };

  const read = (): DaemonSettingsResponse => ({
    authRequired: options.config.authRequired,
    bindHost: options.config.bindHost,
    publicHost: options.config.publicHost,
    allowedOrigins: options.config.configuredAllowedOrigins,
    pairingHosts: options.config.pairingHosts,
    storageMaxMb: Math.round(options.config.storageMaxBytes / (1024 * 1024)),
    agentDataRoots: options.config.agentDataRoots,
    runtimeEndpoints: options.config.runtimeEndpoints,
    lockedFields: [],
    settingsFilePath: options.config.settingsFilePath,
    sources: {
      authRequired: buildSettingSourceDetail(
        options.config.authRequired,
        runtimeStoredSettings.authRequired,
        options.configured.authRequired,
        options.defaults.authRequired
      ),
      publicHost: buildSettingSourceDetail(
        options.config.publicHost,
        runtimeStoredSettings.publicHost,
        options.configured.publicHost,
        options.defaults.publicHost
      ),
      allowedOrigins: buildSettingSourceDetail(
        options.config.configuredAllowedOrigins,
        runtimeStoredSettings.allowedOrigins,
        options.configured.allowedOrigins,
        options.defaults.allowedOrigins
      ),
      pairingHosts: buildSettingSourceDetail(
        options.config.pairingHosts,
        runtimeStoredSettings.pairingHosts,
        null,
        options.defaults.pairingHosts
      ),
      storageMaxMb: buildSettingSourceDetail(
        Math.round(options.config.storageMaxBytes / (1024 * 1024)),
        runtimeStoredSettings.storageMaxMb ?? runtimeStoredSettings.attachedSessionCacheMaxMb,
        options.configured.storageMaxMb,
        options.defaults.storageMaxMb
      ),
      agentDataRoots: buildSettingSourceDetail(
        options.config.agentDataRoots,
        runtimeStoredSettings.agentDataRoots
          ? buildAgentDataRoots(
              runtimeStoredSettings.agentDataRoots,
              options.configured.agentDataRoots,
              options.defaults.agentDataRoots
            )
          : undefined,
        hasKeys(options.configured.agentDataRoots)
          ? buildAgentDataRoots(
              {},
              options.configured.agentDataRoots,
              options.defaults.agentDataRoots
            )
          : null,
        options.defaults.agentDataRoots
      ),
      runtimeEndpoints: buildSettingSourceDetail(
        options.config.runtimeEndpoints,
        runtimeStoredSettings.runtimeEndpoints
          ? buildRuntimeEndpoints(
              runtimeStoredSettings.runtimeEndpoints,
              options.configured.runtimeEndpoints,
              options.defaults.runtimeEndpoints
            )
          : undefined,
        hasKeys(options.configured.runtimeEndpoints)
          ? buildRuntimeEndpoints(
              {},
              options.configured.runtimeEndpoints,
              options.defaults.runtimeEndpoints
            )
          : null,
        options.defaults.runtimeEndpoints
      )
    }
  });

  const update = (input: UpdateDaemonSettingsInput): DaemonSettingsResponse => {
    const updatedSettings: StoredDaemonSettings = {
      ...runtimeStoredSettings
    };

    if (input.authRequired !== undefined) {
      updatedSettings.authRequired = input.authRequired;
      options.config.authRequired = input.authRequired;
    }

    if (input.publicHost !== undefined) {
      updatedSettings.publicHost = normalizePublicHost(input.publicHost);
      options.config.publicHost = updatedSettings.publicHost ?? null;
    }

    if (input.allowedOrigins !== undefined) {
      updatedSettings.allowedOrigins = normalizeAllowedOrigins(input.allowedOrigins);
      options.config.configuredAllowedOrigins = updatedSettings.allowedOrigins;
    }

    if (input.pairingHosts !== undefined) {
      updatedSettings.pairingHosts = normalizePairingHosts(input.pairingHosts);
      options.config.pairingHosts = updatedSettings.pairingHosts;
    }

    if (input.storageMaxMb !== undefined) {
      updatedSettings.storageMaxMb = input.storageMaxMb;
      delete updatedSettings.attachedSessionCacheMaxMb;
      options.config.storageMaxBytes = input.storageMaxMb * 1024 * 1024;
    }

    if (input.agentDataRoots !== undefined) {
      updatedSettings.agentDataRoots = normalizeAgentDataRoots(input.agentDataRoots);
      options.config.agentDataRoots = buildAgentDataRoots(
        updatedSettings.agentDataRoots,
        options.configured.agentDataRoots,
        options.defaults.agentDataRoots
      );
    }

    if (input.runtimeEndpoints !== undefined) {
      updatedSettings.runtimeEndpoints = normalizeRuntimeEndpoints(input.runtimeEndpoints);
      options.config.runtimeEndpointOverrides = buildRuntimeEndpointOverrides(
        updatedSettings.runtimeEndpoints,
        options.configured.runtimeEndpoints
      );
      options.config.runtimeEndpoints = buildRuntimeEndpoints(
        updatedSettings.runtimeEndpoints,
        options.configured.runtimeEndpoints,
        options.defaults.runtimeEndpoints
      );
    }

    refreshAllowedOrigins(options.config);
    runtimeStoredSettings = updatedSettings;
    writeStoredDaemonSettings(options.config.settingsFilePath, updatedSettings);

    return read();
  };

  const reset = (): DaemonSettingsResponse => {
    runtimeStoredSettings = {};
    options.config.authRequired =
      options.configured.authRequired ?? options.defaults.authRequired;
    options.config.publicHost = options.configured.publicHost ?? options.defaults.publicHost;
    options.config.configuredAllowedOrigins =
      options.configured.allowedOrigins ?? options.defaults.allowedOrigins;
    options.config.pairingHosts = options.defaults.pairingHosts;
    options.config.agentDataRoots = buildAgentDataRoots(
      {},
      options.configured.agentDataRoots,
      options.defaults.agentDataRoots
    );
    options.config.runtimeEndpointOverrides = buildRuntimeEndpointOverrides(
      {},
      options.configured.runtimeEndpoints
    );
    options.config.runtimeEndpoints = buildRuntimeEndpoints(
      {},
      options.configured.runtimeEndpoints,
      options.defaults.runtimeEndpoints
    );
    options.config.storageMaxBytes =
      (options.configured.storageMaxMb ?? options.defaults.storageMaxMb) * 1024 * 1024;
    refreshAllowedOrigins(options.config);

    removeStoredDaemonSettings(options.config.settingsFilePath);

    return read();
  };

  return {
    read,
    reset,
    update
  };
}
