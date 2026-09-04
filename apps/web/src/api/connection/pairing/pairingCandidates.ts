import { DEFAULT_DAEMON_PORT } from "@deskcue/protocol";
import { getConnectionConfig, readStoredDaemonUrl } from "@api/connection/configStorage";
import {
  buildLocalDaemonUrl,
  buildPageDaemonUrl,
  buildSameOriginDaemonUrl,
  isLoopbackDaemonUrl,
  isLoopbackHost,
  normalizeDaemonUrl
} from "@api/connection/configUrls";

export function buildPairingDaemonUrlCandidates(queryDaemonUrl: string | null) {
  if (queryDaemonUrl) return [queryDaemonUrl];

  const storedDaemonUrl = readStoredDaemonUrl();
  const sameOriginDaemonUrl = normalizeDaemonUrl(buildSameOriginDaemonUrl(window.location));
  const pageDaemonUrl = normalizeDaemonUrl(buildPageDaemonUrl(window.location));

  if (sameOriginDaemonUrl) return [sameOriginDaemonUrl];
  if (storedDaemonUrl && isLoopbackDaemonUrl(storedDaemonUrl)) return [storedDaemonUrl];
  if (pageDaemonUrl && isLoopbackDaemonUrl(pageDaemonUrl)) return [pageDaemonUrl];

  return [];
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
