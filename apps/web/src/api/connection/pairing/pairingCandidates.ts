import { DEFAULT_DAEMON_PORT } from "@deskcue/protocol";
import { getConnectionConfig } from "@api/connection/configStorage";
import {
  buildLocalDaemonUrl,
  buildPageDaemonUrl,
  buildSameOriginDaemonUrl,
  isLoopbackDaemonUrl,
  isLoopbackHost,
  normalizeDaemonUrl
} from "@api/connection/configUrls";

export function buildPairingDaemonUrlCandidates(queryDaemonUrl: string | null) {
  const candidates = new Set<string>();
  const currentConfig = getConnectionConfig();
  const storedDaemonUrl = normalizeDaemonUrl(currentConfig.daemonUrl);
  const sameOriginDaemonUrl = normalizeDaemonUrl(buildSameOriginDaemonUrl(window.location));
  const pageDaemonUrl = normalizeDaemonUrl(buildPageDaemonUrl(window.location));

  if (queryDaemonUrl) candidates.add(queryDaemonUrl);
  if (sameOriginDaemonUrl) candidates.add(sameOriginDaemonUrl);
  if (storedDaemonUrl) candidates.add(storedDaemonUrl);
  if (pageDaemonUrl) candidates.add(pageDaemonUrl);

  return Array.from(candidates);
}

export function buildLocalAccessLinkCandidates() {
  const candidates = new Set<string>();
  const currentConfig = getConnectionConfig();
  const currentDaemonUrl = normalizeDaemonUrl(currentConfig.daemonUrl);
  const isLoopbackPage = isLoopbackHost(window.location.hostname);
  const loopbackDaemonUrl = buildLocalDaemonUrl(window.location.hostname);

  if (isLoopbackPage) {
    if (loopbackDaemonUrl) candidates.add(loopbackDaemonUrl);
    candidates.add(`http://127.0.0.1:${DEFAULT_DAEMON_PORT}`);
    candidates.add(`http://localhost:${DEFAULT_DAEMON_PORT}`);
  }

  if (currentDaemonUrl && isLoopbackDaemonUrl(currentDaemonUrl)) {
    candidates.add(currentDaemonUrl);
  }

  return Array.from(candidates);
}
