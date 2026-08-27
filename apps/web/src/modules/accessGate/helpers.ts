import { buildCurrentDaemonAccessSettingsUrl } from "@api/connection";

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

export function readReturnPath(search: string) {
  const from = new URLSearchParams(search).get("from");

  if (!from?.startsWith("/") || from.startsWith("//")) return null;

  return from;
}
