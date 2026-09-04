import {
  buildPageDaemonUrl,
  chooseDaemonUrlForPage,
  collectNormalizedDaemonUrls,
  isLoopbackHost,
  normalizeDaemonUrl,
  normalizeToken,
  readFirstNormalizedDaemonUrl,
  readFirstNormalizedToken
} from "./configUrls";
import { emitConnectionConfigChangedEvent } from "./events";

const DAEMON_URL_STORAGE_KEY = "deskcue.daemonUrl";
const LEGACY_ACCESS_TOKEN_STORAGE_KEY = "deskcue.accessToken";
const ACCESS_DEVICE_ID_STORAGE_KEY = "deskcue.accessDeviceId";

export type ConnectionConfig = {
  accessToken: string | null;
  deviceId: string | null;
  daemonUrl: string;
};

let cachedConfig: ConnectionConfig | null = null;

function clearLegacyCredentialQueryParams(query: URLSearchParams) {
  if (!query.has("deskcueToken") && !query.has("token")) {
    return;
  }

  query.delete("deskcueToken");
  query.delete("token");
  const search = query.size > 0 ? `?${query.toString()}` : "";

  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${search}${window.location.hash}`
  );
}

export function readStoredDaemonUrl() {
  return normalizeDaemonUrl(localStorage.getItem(DAEMON_URL_STORAGE_KEY));
}

function readConnectionConfig(): ConnectionConfig {
  const query = new URLSearchParams(window.location.search);
  const queryDaemonValues = [
    ...query.getAll("deskcueDaemon"),
    ...query.getAll("daemon")
  ];
  const queryDaemonUrls = collectNormalizedDaemonUrls(queryDaemonValues);
  const hasAmbiguousQueryDaemonUrl = queryDaemonUrls.size > 1;
  const queryDaemonUrl = hasAmbiguousQueryDaemonUrl
    ? null
    : readFirstNormalizedDaemonUrl(queryDaemonValues);
  const storedDaemonUrl = readStoredDaemonUrl();
  const pageDaemonUrl = buildPageDaemonUrl(window.location);
  const isLoopbackPage = isLoopbackHost(window.location.hostname);
  const daemonUrl =
    queryDaemonUrl ?? chooseDaemonUrlForPage(storedDaemonUrl, pageDaemonUrl) ?? "";
  const queryTokenValues = [
    ...query.getAll("deskcueToken"),
    ...query.getAll("token")
  ];
  const queryToken = readFirstNormalizedToken(queryTokenValues);

  clearLegacyCredentialQueryParams(query);

  if (!hasAmbiguousQueryDaemonUrl) {
    if (queryDaemonUrl) {
      localStorage.setItem(DAEMON_URL_STORAGE_KEY, queryDaemonUrl);
    } else if (daemonUrl && daemonUrl !== storedDaemonUrl) {
      localStorage.setItem(DAEMON_URL_STORAGE_KEY, daemonUrl);
    }
  }

  if (queryToken) {
    localStorage.removeItem(LEGACY_ACCESS_TOKEN_STORAGE_KEY);
  } else if (isLoopbackPage) {
    localStorage.removeItem(LEGACY_ACCESS_TOKEN_STORAGE_KEY);
    localStorage.removeItem(ACCESS_DEVICE_ID_STORAGE_KEY);
  } else {
    localStorage.removeItem(LEGACY_ACCESS_TOKEN_STORAGE_KEY);
  }

  return {
    accessToken: queryToken,
    deviceId: isLoopbackPage ? null : normalizeToken(localStorage.getItem(ACCESS_DEVICE_ID_STORAGE_KEY)),
    daemonUrl
  };
}

function areConnectionConfigsEqual(left: ConnectionConfig, right: ConnectionConfig) {
  return left.accessToken === right.accessToken &&
    left.deviceId === right.deviceId &&
    left.daemonUrl === right.daemonUrl;
}

export function getConnectionConfig(): ConnectionConfig {
  if (!cachedConfig) {
    cachedConfig = readConnectionConfig();
  }

  return cachedConfig;
}

export function getAccessToken() {
  return getConnectionConfig().accessToken;
}

export function hasBrowserAccessCredential() {
  const config = getConnectionConfig();

  return Boolean(config.accessToken || config.deviceId);
}

export function saveConnectionConfig(config: ConnectionConfig) {
  const previousConfig = getConnectionConfig();

  localStorage.setItem(DAEMON_URL_STORAGE_KEY, config.daemonUrl);

  localStorage.removeItem(LEGACY_ACCESS_TOKEN_STORAGE_KEY);

  if (config.deviceId) {
    localStorage.setItem(ACCESS_DEVICE_ID_STORAGE_KEY, config.deviceId);
  } else {
    localStorage.removeItem(ACCESS_DEVICE_ID_STORAGE_KEY);
  }

  cachedConfig = config;
  if (!areConnectionConfigsEqual(previousConfig, config)) {
    emitConnectionConfigChangedEvent();
  }
}

export function forgetAccessToken() {
  const currentConfig = getConnectionConfig();

  localStorage.removeItem(LEGACY_ACCESS_TOKEN_STORAGE_KEY);

  localStorage.removeItem(ACCESS_DEVICE_ID_STORAGE_KEY);
  cachedConfig = {
    ...currentConfig,
    accessToken: null,
    deviceId: null
  };

  emitConnectionConfigChangedEvent();
}

export function invalidateConnectionConfigCache() {
  cachedConfig = null;
}

export function isConnectionConfigStorageKey(key: string | null) {
  return (
    key === DAEMON_URL_STORAGE_KEY ||
    key === LEGACY_ACCESS_TOKEN_STORAGE_KEY ||
    key === ACCESS_DEVICE_ID_STORAGE_KEY
  );
}
