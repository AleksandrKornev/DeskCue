import type {
  SecurityExposureLevel,
  SecurityRiskLevel,
  SecurityStatusResponse
} from "@deskcue/protocol";
import { DESKCUE_PROTOCOL_CAPABILITIES, DESKCUE_PROTOCOL_VERSION } from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";

function buildSecuritySummary(
  exposureLevel: SecurityExposureLevel,
  authRequired: boolean
) {
  if (exposureLevel === "local_only") {
    return authRequired
      ? "Local access is protected by an access token"
      : "Local access is restricted to this machine, but API auth is disabled";
  }

  if (authRequired) {
    return "DeskCue is reachable beyond this computer and requires an access token";
  }

  return "DeskCue is reachable beyond this computer without access protection";
}

function buildSecurityWarnings(
  exposureLevel: SecurityExposureLevel,
  authRequired: boolean
) {
  if (exposureLevel === "local_only") {
    return authRequired
      ? []
      : ["Local-only mode is convenient for development, but any local process can call the DeskCue API"];
  }

  if (authRequired) {
    return [
      "Keep the access token private. Anyone with the token can control local DeskCue sessions"
    ];
  }

  return [
    "Anyone who can reach DeskCue can control local agent sessions",
    "CORS is not an access-control boundary for direct HTTP clients",
    "Enable DESKCUE_AUTH_REQUIRED=true before exposing DeskCue on LAN or the public internet"
  ];
}

export function classifyRiskLevel(
  exposureLevel: SecurityExposureLevel,
  authRequired: boolean
): SecurityRiskLevel {
  if (exposureLevel === "local_only") {
    return authRequired ? "low" : "medium";
  }

  if (authRequired) {
    return "medium";
  }

  return "high";
}

function readHostName(value: string) {
  try {
    const url = value.includes("://")
      ? new URL(value)
      : new URL(`http://${value}`);
    return url.hostname;
  } catch {
    return value;
  }
}

function isLocalHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function classifyExposureLevel(
  bindHost: string,
  publicHost: string | null
): SecurityExposureLevel {
  if (publicHost && !isLocalHost(readHostName(publicHost))) {
    return "public_exposed";
  }

  if (isLocalHost(bindHost)) {
    return "local_only";
  }

  return "lan_exposed";
}

export function buildSecurityStatus(): SecurityStatusResponse {
  const exposureLevel = classifyExposureLevel(daemonConfig.bindHost, daemonConfig.publicHost);
  const riskLevel = classifyRiskLevel(exposureLevel, daemonConfig.authRequired);
  const warnings = buildSecurityWarnings(exposureLevel, daemonConfig.authRequired);

  return {
    authRequired: daemonConfig.authRequired,
    bindHost: daemonConfig.bindHost,
    publicHost: daemonConfig.publicHost,
    allowedOrigins: daemonConfig.allowedOrigins,
    accessTokenSource: "devices",
    exposureLevel,
    protocolCapabilities: [...DESKCUE_PROTOCOL_CAPABILITIES],
    protocolVersion: DESKCUE_PROTOCOL_VERSION,
    riskLevel,
    summary: buildSecuritySummary(exposureLevel, daemonConfig.authRequired),
    warnings
  };
}
