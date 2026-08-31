import { buildCurrentDaemonAccessSettingsUrl } from "@api/connection";
import { readFirstNormalizedToken } from "@api/connection/configUrls";
import {
  readPairCodeFromPath,
  readRecoveryCodeFromPath
} from "@api/connection/pairing/pairingUrlCodes";

export function buildHostAccessSettingsUrl() {
  return buildCurrentDaemonAccessSettingsUrl();
}

export function hasSavedAccessCredential() {
  return Boolean(
    localStorage.getItem("deskcue.accessToken") ||
    localStorage.getItem("deskcue.accessDeviceId")
  );
}

export function clearSavedAccessCredential() {
  localStorage.removeItem("deskcue.accessToken");
  localStorage.removeItem("deskcue.accessDeviceId");
}

export function buildRecoveryUrlExample() {
  return `${window.location.origin}/recover/<code>`;
}

export type ConnectionPreparationKind = "pair" | "recover";

function hasConnectionPreparationQueryToken(query: URLSearchParams, names: string[]) {
  return names.some((name) => query.getAll(name).some((value) => Boolean(value.trim())));
}

export function readConnectionPreparationKind(path: string): ConnectionPreparationKind | null {
  try {
    const url = new URL(path, window.location.origin);

    if (url.origin !== window.location.origin) return null;

    const pairPathCode = readFirstNormalizedToken([readPairCodeFromPath(url.pathname)]);
    const recoveryPathCode = readFirstNormalizedToken([readRecoveryCodeFromPath(url.pathname)]);

    if (pairPathCode) return "pair";
    if (recoveryPathCode) return "recover";
    if (hasConnectionPreparationQueryToken(url.searchParams, ["deskcuePair", "pair"])) return "pair";
    if (hasConnectionPreparationQueryToken(url.searchParams, ["deskcueRecovery", "recovery"])) return "recover";

    return null;
  } catch {
    return null;
  }
}

export function readReturnPath(search: string) {
  const from = new URLSearchParams(search).get("from");

  if (!from?.startsWith("/") || from.startsWith("//")) return null;
  if (from.includes("\\") || /%5c/i.test(from)) return null;

  try {
    const returnUrl = new URL(from, window.location.origin);

    if (returnUrl.origin !== window.location.origin) return null;

    return `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
  } catch {
    return null;
  }
}

export function readConnectionPreparationRetryPath(search: string) {
  const query = new URLSearchParams(search);
  const reason = query.get("reason");

  if (reason !== "offline" && reason !== "preparation") return null;

  const returnPath = readReturnPath(search);

  return returnPath && readConnectionPreparationKind(returnPath) ? returnPath : null;
}
