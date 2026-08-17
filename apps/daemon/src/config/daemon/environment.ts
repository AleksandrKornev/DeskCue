import os from "node:os";
import { join, resolve } from "node:path";

import type { AgentDataRoots, RuntimeEndpoints } from "@deskcue/protocol";
import { DEFAULT_DAEMON_PORT } from "@deskcue/protocol";

import {
  readCookieSecureEnv,
  readHttpCompressionEnv,
  readOptionalBooleanEnv,
  readOptionalListEnv,
  readOptionalStringEnv,
  readPositiveIntegerEnv,
  readStorageSizeMbEnv
} from "../daemonEnv.ts";
import { readConfiguredAgentDataRoots, readConfiguredRuntimeEndpoints } from "./runtime.ts";
import type { ConfiguredAgentDataRoots, ConfiguredRuntimeEndpoints } from "./runtime.ts";
import {
  getDefaultDataRootPath,
  getDefaultLegacyLocalChatLibraryPath,
  getLegacyDaemonDataRootPath,
  getLocalChatLibraryPath,
  getServiceDataPath,
  migrateStorageLayout
} from "../storageLayout.ts";

export type DaemonConfigPaths = {
  dataRootPath: string;
  databaseFilePath: string;
  localChatLibraryPath: string;
  serviceDataPath: string;
  settingsFilePath: string;
  stateFilePath: string;
};

export type DaemonConfigDefaults = {
  agentDataRoots: AgentDataRoots;
  allowedOrigins: string[];
  authRequired: boolean;
  bindHost: string;
  localChatLibraryMaxMb: number;
  pairingHosts: string[];
  publicHost: string | null;
  runtimeEndpoints: RuntimeEndpoints;
  storageMaxMb: number;
};

export type DaemonConfigConfiguredValues = {
  agentDataRoots: ConfiguredAgentDataRoots;
  allowedOrigins: string[] | null;
  authRequired: boolean | null;
  daemonPort: number;
  localChatLibraryMaxMb: number | null;
  localLlmDeniedExecutables: string[] | null;
  publicHost: string | null;
  runtimeEndpoints: ConfiguredRuntimeEndpoints;
  storageMaxMb: number | null;
};

export type DaemonConfigStaticValues = {
  agentSessionDiscoveryCacheTtlMs: number;
  agentSessionIndexFilePath: string;
  agentSessionIndexSnapshotTtlMs: number;
  agentSessionSyncIntervalMs: number;
  bindHost: string;
  cookieSecure: "auto" | boolean;
  daemonPort: number;
  databaseFilePath: string;
  healthCheckTimeoutMs: number;
  heavyAgentRequestRateLimitMax: number;
  heavyAgentRequestRateLimitWindowMs: number;
  httpCompression: "auto" | "off";
  initialInputDelayMs: number;
  listenRetryAttempts: number;
  listenRetryDelayMs: number;
  localChatLibraryPath: string;
  localChatLibraryQuotaBytes: number;
  localLlmDeniedExecutables: string[];
  localLlmGenerationQueueCapacity: number;
  localLlmMaxConcurrentGenerations: number;
  notificationProviderTimeoutMs: number;
  notificationWebhookUrl: string | null;
  persistDebounceMs: number;
  previewProxyPort: number;
  runtimeCommandTimeoutMs: number;
  runtimeHttpTimeoutMs: number;
  sessionGitPollingIntervalMs: number;
  settingsFilePath: string;
  shutdownTimeoutMs: number;
  sourceAgentActiveTurnStaleMs: number;
  sourceAgentNotificationPollingIntervalMs: number;
  stateFilePath: string;
  websocketHeartbeatIntervalMs: number;
};

export type DaemonConfigEnvironment = {
  configured: DaemonConfigConfiguredValues;
  defaults: DaemonConfigDefaults;
  staticValues: DaemonConfigStaticValues;
};

function isNodeTestRuntime() {
  return process.env.NODE_TEST_CONTEXT !== undefined || process.execArgv.includes("--test");
}

function readPreviewProxyPort(daemonPort: number) {
  const fallbackPort = daemonPort < 65_535 ? daemonPort + 1 : DEFAULT_DAEMON_PORT + 1;
  const configuredPort = readPositiveIntegerEnv("DESKCUE_PREVIEW_PROXY_PORT", fallbackPort);
  return configuredPort <= 65_535 && configuredPort !== daemonPort
    ? configuredPort
    : fallbackPort;
}

export function resolveDaemonConfigPaths(): DaemonConfigPaths {
  const defaultDataRootPath = isNodeTestRuntime()
    ? join(os.tmpdir(), `deskcue-daemon-node-test-${process.pid}`)
    : getDefaultDataRootPath();
  const dataRootPath = readOptionalStringEnv("DESKCUE_DATA_DIR") ?? defaultDataRootPath;
  const configuredLocalChatLibraryPath = readOptionalStringEnv(
    "DESKCUE_LOCAL_CHAT_LIBRARY_DIR"
  );
  const usesSourceCheckoutDataRoot = resolve(dataRootPath) === resolve(getDefaultDataRootPath());

  migrateStorageLayout({
    dataRootPath,
    ...(usesSourceCheckoutDataRoot
      ? {
          legacyDataRootPath: getLegacyDaemonDataRootPath(),
          legacyLocalChatLibraryPath: getDefaultLegacyLocalChatLibraryPath()
        }
      : {}),
    migrateLocalChats: configuredLocalChatLibraryPath === null && usesSourceCheckoutDataRoot
  });

  const serviceDataPath = getServiceDataPath(dataRootPath);

  return {
    dataRootPath,
    databaseFilePath: join(serviceDataPath, "deskcue.sqlite"),
    localChatLibraryPath:
      configuredLocalChatLibraryPath ?? getLocalChatLibraryPath(dataRootPath),
    serviceDataPath,
    settingsFilePath: join(serviceDataPath, "daemon-settings.json"),
    stateFilePath: join(serviceDataPath, "state.json")
  };
}

export function readDaemonConfigEnvironment(paths: DaemonConfigPaths): DaemonConfigEnvironment {
  const defaults: DaemonConfigDefaults = {
    agentDataRoots: {
      codexHome: join(os.homedir(), ".codex"),
      claudeHome: join(os.homedir(), ".claude"),
      lmStudioHome: join(os.homedir(), ".lmstudio")
    },
    allowedOrigins: [],
    authRequired: true,
    bindHost: "0.0.0.0",
    localChatLibraryMaxMb: 1024,
    pairingHosts: [],
    publicHost: null,
    runtimeEndpoints: {
      ollamaEndpoint: "http://127.0.0.1:11434",
      lmStudioEndpoint: "http://127.0.0.1:1234"
    },
    storageMaxMb: 50
  };
  const authRequired = readOptionalBooleanEnv("DESKCUE_AUTH_REQUIRED");
  const publicHost = readOptionalStringEnv("DESKCUE_PUBLIC_HOST");
  const allowedOrigins = readOptionalListEnv("DESKCUE_ALLOWED_ORIGINS");
  const daemonPort = readPositiveIntegerEnv("DESKCUE_DAEMON_PORT", DEFAULT_DAEMON_PORT);
  const previewProxyPort = readPreviewProxyPort(daemonPort);
  const storageMaxMb = readStorageSizeMbEnv("DESKCUE_STORAGE_MAX_MB");
  const localChatLibraryMaxMb = readStorageSizeMbEnv(
    "DESKCUE_LOCAL_CHAT_LIBRARY_MAX_MB"
  );
  const localLlmDeniedExecutables = readOptionalListEnv(
    "DESKCUE_LOCAL_LLM_DENY_EXECUTABLES"
  );
  const agentDataRoots = readConfiguredAgentDataRoots();
  const runtimeEndpoints = readConfiguredRuntimeEndpoints();
  const configured: DaemonConfigConfiguredValues = {
    agentDataRoots,
    allowedOrigins,
    authRequired,
    daemonPort,
    localChatLibraryMaxMb,
    localLlmDeniedExecutables,
    publicHost,
    runtimeEndpoints,
    storageMaxMb
  };

  return {
    configured,
    defaults,
    staticValues: {
      agentSessionSyncIntervalMs: readPositiveIntegerEnv(
        "DESKCUE_AGENT_SESSION_SYNC_INTERVAL_MS",
        2500
      ),
      agentSessionDiscoveryCacheTtlMs: readPositiveIntegerEnv(
        "DESKCUE_AGENT_DISCOVERY_CACHE_TTL_MS",
        5000
      ),
      agentSessionIndexFilePath:
        readOptionalStringEnv("DESKCUE_AGENT_SESSION_INDEX_FILE") ??
        join(paths.serviceDataPath, "source-agent-index.json"),
      agentSessionIndexSnapshotTtlMs: readPositiveIntegerEnv(
        "DESKCUE_AGENT_SESSION_INDEX_SNAPSHOT_TTL_MS",
        15000
      ),
      cookieSecure: readCookieSecureEnv("DESKCUE_COOKIE_SECURE"),
      bindHost: readOptionalStringEnv("DESKCUE_BIND_HOST") ?? defaults.bindHost,
      databaseFilePath:
        readOptionalStringEnv("DESKCUE_DATABASE_FILE") ?? paths.databaseFilePath,
      daemonPort: configured.daemonPort,
      sourceAgentActiveTurnStaleMs: readPositiveIntegerEnv(
        "DESKCUE_SOURCE_AGENT_ACTIVE_TURN_STALE_MS",
        2 * 60 * 1000
      ),
      healthCheckTimeoutMs: readPositiveIntegerEnv("DESKCUE_HEALTH_CHECK_TIMEOUT_MS", 350),
      heavyAgentRequestRateLimitMax: readPositiveIntegerEnv(
        "DESKCUE_HEAVY_AGENT_REQUEST_RATE_LIMIT_MAX",
        240
      ),
      heavyAgentRequestRateLimitWindowMs: readPositiveIntegerEnv(
        "DESKCUE_HEAVY_AGENT_REQUEST_RATE_LIMIT_WINDOW_MS",
        60_000
      ),
      httpCompression: readHttpCompressionEnv("DESKCUE_HTTP_COMPRESSION"),
      initialInputDelayMs: readPositiveIntegerEnv("DESKCUE_INITIAL_INPUT_DELAY_MS", 200),
      localChatLibraryPath: paths.localChatLibraryPath,
      localChatLibraryQuotaBytes:
        (configured.localChatLibraryMaxMb ?? defaults.localChatLibraryMaxMb) * 1024 * 1024,
      localLlmDeniedExecutables: configured.localLlmDeniedExecutables ?? [],
      localLlmGenerationQueueCapacity: readPositiveIntegerEnv(
        "DESKCUE_LOCAL_LLM_GENERATION_QUEUE_CAPACITY",
        16
      ),
      localLlmMaxConcurrentGenerations: readPositiveIntegerEnv(
        "DESKCUE_LOCAL_LLM_MAX_CONCURRENT_GENERATIONS",
        2
      ),
      listenRetryAttempts: readPositiveIntegerEnv("DESKCUE_LISTEN_RETRY_ATTEMPTS", 24),
      listenRetryDelayMs: readPositiveIntegerEnv("DESKCUE_LISTEN_RETRY_DELAY_MS", 250),
      notificationProviderTimeoutMs: readPositiveIntegerEnv(
        "DESKCUE_NOTIFICATION_PROVIDER_TIMEOUT_MS",
        readPositiveIntegerEnv("DESKCUE_SESSION_WEBHOOK_TIMEOUT_MS", 10_000)
      ),
      notificationWebhookUrl: readOptionalStringEnv("DESKCUE_SESSION_WEBHOOK_URL"),
      persistDebounceMs: readPositiveIntegerEnv("DESKCUE_PERSIST_DEBOUNCE_MS", 750),
      previewProxyPort,
      runtimeCommandTimeoutMs: readPositiveIntegerEnv(
        "DESKCUE_RUNTIME_COMMAND_TIMEOUT_MS",
        3000
      ),
      runtimeHttpTimeoutMs: readPositiveIntegerEnv("DESKCUE_RUNTIME_HTTP_TIMEOUT_MS", 1200),
      sourceAgentNotificationPollingIntervalMs: readPositiveIntegerEnv(
        "DESKCUE_SOURCE_AGENT_NOTIFICATION_POLLING_INTERVAL_MS",
        5000
      ),
      sessionGitPollingIntervalMs: readPositiveIntegerEnv(
        "DESKCUE_SESSION_GIT_POLLING_INTERVAL_MS",
        4000
      ),
      settingsFilePath: paths.settingsFilePath,
      shutdownTimeoutMs: readPositiveIntegerEnv("DESKCUE_SHUTDOWN_TIMEOUT_MS", 3000),
      stateFilePath: readOptionalStringEnv("DESKCUE_STATE_FILE") ?? paths.stateFilePath,
      websocketHeartbeatIntervalMs: readPositiveIntegerEnv(
        "DESKCUE_WEBSOCKET_HEARTBEAT_INTERVAL_MS",
        30000
      )
    }
  };
}
