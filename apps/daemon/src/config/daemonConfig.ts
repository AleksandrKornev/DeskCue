import type {
  AgentDataRoots,
  DaemonSettingsResponse,
  RuntimeEndpoints,
  UpdateDaemonSettingsInput
} from "@deskcue/protocol";

import { readDaemonConfigEnvironment, resolveDaemonConfigPaths } from "./daemon/environment.ts";
import { buildAllowedOrigins } from "./daemon/origins.ts";
import { createDaemonSettingsController } from "./daemon/publicSettings.ts";
import type { DaemonSettingsController } from "./daemon/publicSettings.ts";
import {
  buildAgentDataRoots,
  buildRuntimeEndpointOverrides,
  buildRuntimeEndpoints
} from "./daemon/runtime.ts";
import { readStoredDaemonSettings } from "./daemonSettingsStore.ts";

export type DaemonConfig = {
  authRequired: boolean;
  agentSessionSyncIntervalMs: number;
  agentSessionDiscoveryCacheTtlMs: number;
  agentSessionIndexFilePath: string;
  agentSessionIndexSnapshotTtlMs: number;
  allowedOrigins: string[];
  agentDataRoots: AgentDataRoots;
  runtimeEndpointOverrides: Partial<Record<keyof RuntimeEndpoints, string>>;
  runtimeEndpoints: RuntimeEndpoints;
  configuredAllowedOrigins: string[];
  cookieSecure: "auto" | boolean;
  pairingHosts: string[];
  bindHost: string;
  databaseFilePath: string;
  daemonPort: number;
  sourceAgentActiveTurnStaleMs: number;
  healthCheckTimeoutMs: number;
  heavyAgentRequestRateLimitMax: number;
  heavyAgentRequestRateLimitWindowMs: number;
  httpCompression: "auto" | "off";
  initialInputDelayMs: number;
  localChatLibraryPath: string;
  localChatLibraryQuotaBytes: number;
  localLlmDeniedExecutables: string[];
  localLlmGenerationQueueCapacity: number;
  localLlmMaxConcurrentGenerations: number;
  listenRetryAttempts: number;
  listenRetryDelayMs: number;
  notificationProviderTimeoutMs: number;
  notificationWebhookUrl: string | null;
  persistDebounceMs: number;
  previewProxyPort: number;
  publicHost: string | null;
  runtimeCommandTimeoutMs: number;
  runtimeHttpTimeoutMs: number;
  sourceAgentNotificationPollingIntervalMs: number;
  sessionGitPollingIntervalMs: number;
  settingsFilePath: string;
  shutdownTimeoutMs: number;
  stateFilePath: string;
  websocketHeartbeatIntervalMs: number;
  storageMaxBytes: number;
};

const paths = resolveDaemonConfigPaths();
const storedSettings = readStoredDaemonSettings(paths.settingsFilePath);
const environment = readDaemonConfigEnvironment(paths);
const { configured, defaults, staticValues } = environment;

const publicHost = storedSettings.publicHost ?? configured.publicHost ?? defaults.publicHost;
const configuredAllowedOrigins =
  storedSettings.allowedOrigins ?? configured.allowedOrigins ?? defaults.allowedOrigins;
const pairingHosts = storedSettings.pairingHosts ?? defaults.pairingHosts;
const agentDataRoots = buildAgentDataRoots(
  storedSettings.agentDataRoots,
  configured.agentDataRoots,
  defaults.agentDataRoots
);
const runtimeEndpointOverrides = buildRuntimeEndpointOverrides(
  storedSettings.runtimeEndpoints,
  configured.runtimeEndpoints
);
const runtimeEndpoints = buildRuntimeEndpoints(
  storedSettings.runtimeEndpoints,
  configured.runtimeEndpoints,
  defaults.runtimeEndpoints
);

export const daemonConfig: DaemonConfig = {
  ...staticValues,
  authRequired:
    storedSettings.authRequired ?? configured.authRequired ?? defaults.authRequired,
  allowedOrigins: buildAllowedOrigins(
    configuredAllowedOrigins,
    publicHost,
    pairingHosts,
    configured.daemonPort
  ),
  agentDataRoots,
  runtimeEndpointOverrides,
  runtimeEndpoints,
  configuredAllowedOrigins,
  pairingHosts,
  publicHost,
  storageMaxBytes:
    (storedSettings.storageMaxMb ??
      storedSettings.attachedSessionCacheMaxMb ??
      configured.storageMaxMb ??
      defaults.storageMaxMb) *
    1024 *
    1024
};

const settingsController: DaemonSettingsController = createDaemonSettingsController({
  config: daemonConfig,
  configured,
  defaults,
  storedSettings
});

export function readDaemonSettings(): DaemonSettingsResponse {
  return settingsController.read();
}

export function updateDaemonSettings(input: UpdateDaemonSettingsInput): DaemonSettingsResponse {
  return settingsController.update(input);
}

export function resetDaemonSettings(): DaemonSettingsResponse {
  return settingsController.reset();
}
