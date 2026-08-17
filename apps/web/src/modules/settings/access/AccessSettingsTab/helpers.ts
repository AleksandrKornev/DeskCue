import type { AccessLinkResponse, SecurityStatusResponse } from "@deskcue/protocol";

export function formatRiskLabel(riskLevel: SecurityStatusResponse["riskLevel"]) {
  if (riskLevel === "low") {
    return "Low risk";
  }

  if (riskLevel === "medium") {
    return "Review";
  }

  return "High risk";
}

export function formatExposureLevel(exposureLevel: SecurityStatusResponse["exposureLevel"]) {
  if (exposureLevel === "local_only") {
    return "Local only";
  }

  if (exposureLevel === "lan_exposed") {
    return "LAN exposed";
  }

  return "Public exposed";
}

export function formatBooleanValue(value: boolean | null) {
  if (value === null) {
    return "Not configured";
  }

  return value ? "On" : "Off";
}

export function formatStringValue(value: string | null) {
  return value || "Not configured";
}

export function formatOriginsValue(value: string[] | null) {
  return value && value.length > 0 ? value.join(", ") : "Not configured";
}

export function formatSavedPairingHostsSummary(hosts: string[]) {
  if (hosts.length === 0) {
    return "No saved hosts yet";
  }

  return `${hosts.length} saved host${hosts.length === 1 ? "" : "s"} available`;
}

export function formatPairingActionSummary(hosts: string[]) {
  if (hosts.length === 0) {
    return "Uses generated host unless you add saved addresses";
  }

  if (hosts.length === 1) {
    return `Uses saved host: ${hosts[0]}`;
  }

  return `${hosts.length} saved hosts available`;
}

function normalizePairingOrigin(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function buildPairingWebUrl(pairingLink: AccessLinkResponse, originInput: string) {
  const origin = normalizePairingOrigin(originInput);
  if (!origin) {
    return pairingLink.webUrl;
  }

  const url = new URL(origin);
  url.pathname = `/pair/${encodeURIComponent(pairingLink.pairCode)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildSavedPairingHostOptions(savedHosts: string[]) {
  const options: Array<{ label: string; value: string }> = [];

  for (const savedHost of savedHosts) {
    const origin = normalizePairingOrigin(savedHost);
    if (!origin || options.some((option) => option.value === origin)) {
      continue;
    }

    options.push({
      label: origin,
      value: origin
    });
  }

  return options;
}

export function readPairingWebOrigin(webUrl: string) {
  try {
    return new URL(webUrl).origin;
  } catch {
    return "";
  }
}
