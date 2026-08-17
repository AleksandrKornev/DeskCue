import type { PairAccessResponse } from "@deskcue/protocol";
import { getConnectionConfig, saveConnectionConfig } from "@api/connection/configStorage";
import {
  isSameOriginDaemonUrl,
  normalizeDaemonUrl,
  normalizeToken
} from "@api/connection/configUrls";

import {
  buildLocalAccessLinkCandidates,
  buildPairingDaemonUrlCandidates
} from "./pairingCandidates";
import { fetchLocalAccessLink, fetchPairingEndpoint } from "./pairingTransport";
import type { AccessLinkTarget } from "./pairingTransport";
import {
  clearPairingQueryParams,
  readPairCodeFromPath,
  readRecoveryCodeFromPath
} from "./pairingUrlCodes";

let pairingPromise: Promise<void> | null = null;

async function pairWithDaemon(daemonUrl: string, pairCode: string) {
  const response = await fetchPairingEndpoint(
    `${daemonUrl}/api/access/pair`,
    { code: pairCode },
    "Unable to pair this DeskCue client"
  );
  const payload = (await response.json()) as PairAccessResponse;
  saveConnectionConfig({
    accessToken: null,
    deviceId: payload.deviceId,
    daemonUrl: isSameOriginDaemonUrl(daemonUrl)
      ? daemonUrl
      : normalizeDaemonUrl(payload.daemonUrl) ?? daemonUrl
  });
}

async function recoverWithDaemon(daemonUrl: string, recoveryCode: string) {
  const response = await fetchPairingEndpoint(
    `${daemonUrl}/api/access/recover`,
    { code: recoveryCode },
    "Unable to recover this DeskCue client"
  );
  const payload = (await response.json()) as PairAccessResponse;
  saveConnectionConfig({
    accessToken: null,
    deviceId: payload.deviceId,
    daemonUrl: isSameOriginDaemonUrl(daemonUrl)
      ? daemonUrl
      : normalizeDaemonUrl(payload.daemonUrl) ?? daemonUrl
  });
}

async function recoverWithFirstAvailableDaemon(daemonUrls: string[], recoveryCode: string) {
  let lastError: unknown = null;
  for (const daemonUrl of daemonUrls) {
    try {
      await recoverWithDaemon(daemonUrl, recoveryCode);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to recover this DeskCue client");
}

async function pairWithFirstAvailableDaemon(daemonUrls: string[], pairCode: string) {
  let lastError: unknown = null;
  for (const daemonUrl of daemonUrls) {
    try {
      await pairWithDaemon(daemonUrl, pairCode);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to pair this DeskCue client");
}

async function recoverFromUrlIfNeeded() {
  const query = new URLSearchParams(window.location.search);
  const recoveryCode = normalizeToken(
    query.get("deskcueRecovery") ?? query.get("recovery") ??
    readRecoveryCodeFromPath(window.location.pathname)
  );
  const queryDaemonUrl = normalizeDaemonUrl(query.get("deskcueDaemon") ?? query.get("daemon"));
  if (!recoveryCode) return;
  await recoverWithFirstAvailableDaemon(buildPairingDaemonUrlCandidates(queryDaemonUrl), recoveryCode);
  clearPairingQueryParams();
}

async function pairFromUrlIfNeeded() {
  const query = new URLSearchParams(window.location.search);
  const pairCode = normalizeToken(
    query.get("deskcuePair") ?? query.get("pair") ?? readPairCodeFromPath(window.location.pathname)
  );
  const queryDaemonUrl = normalizeDaemonUrl(query.get("deskcueDaemon") ?? query.get("daemon"));
  if (!pairCode) return;
  await pairWithFirstAvailableDaemon(buildPairingDaemonUrlCandidates(queryDaemonUrl), pairCode);
  clearPairingQueryParams();
}

async function preparePairing() {
  await recoverFromUrlIfNeeded();
  await pairFromUrlIfNeeded();
}

export function prepareConnectionConfig() {
  if (!pairingPromise) {
    const request = preparePairing().catch((error) => {
      if (pairingPromise === request) pairingPromise = null;
      throw error;
    });
    pairingPromise = request;
  }
  return pairingPromise;
}

export async function createLocalAccessLink(target: AccessLinkTarget = "local") {
  for (const daemonUrl of buildLocalAccessLinkCandidates()) {
    const link = await fetchLocalAccessLink(daemonUrl, target);
    if (link) return link;
  }
  return null;
}

export async function ensureLocalAccessToken() {
  const currentConfig = getConnectionConfig();
  if ((currentConfig.accessToken || currentConfig.deviceId) && currentConfig.daemonUrl) {
    return currentConfig;
  }

  const link = await createLocalAccessLink();
  if (!link) return null;
  await pairWithDaemon(normalizeDaemonUrl(link.daemonUrl) ?? currentConfig.daemonUrl, link.pairCode);
  return getConnectionConfig();
}
