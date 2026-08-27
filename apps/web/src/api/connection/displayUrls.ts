import { DEFAULT_DAEMON_PORT } from "@deskcue/protocol";

import { getConnectionConfig } from "./configStorage";
import { isLoopbackHost, normalizeDaemonUrl } from "./configUrls";

export function readCurrentDaemonWebOrigin(
  location: Location = window.location,
  development = import.meta.env.DEV
) {
  const configuredDaemonUrl = normalizeDaemonUrl(getConnectionConfig().daemonUrl);

  if (configuredDaemonUrl) return configuredDaemonUrl;

  if (!isLoopbackHost(location.hostname) || !development) {
    return `${location.protocol}//${location.host}`;
  }

  return `http://127.0.0.1:${DEFAULT_DAEMON_PORT}`;
}

export function buildCurrentDaemonAccessSettingsUrl(
  location: Location = window.location,
  development = import.meta.env.DEV
) {
  return `${readCurrentDaemonWebOrigin(location, development)}/settings?tab=access`;
}

export function readDaemonUrlPort(value: string) {
  try {
    const url = new URL(value);

    if (url.port) return url.port;
    if (url.protocol === "http:") return "80";
    if (url.protocol === "https:") return "443";
  } catch {
    return null;
  }

  return null;
}
