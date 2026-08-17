import { normalize } from "node:path";

import type { AgentDataRoots, RuntimeEndpoints } from "@deskcue/protocol";

export type StoredDaemonSettings = {
  authRequired?: boolean;
  publicHost?: string | null;
  allowedOrigins?: string[];
  pairingHosts?: string[];
  storageMaxMb?: number;
  attachedSessionCacheMaxMb?: number;
  agentDataRoots?: Partial<Record<keyof AgentDataRoots, string | null>>;
  runtimeEndpoints?: Partial<Record<keyof RuntimeEndpoints, string | null>>;
};

export function normalizePublicHost(value: string | null | undefined) {
  const publicHost = value?.trim();
  return publicHost || null;
}

function normalizeOptionalPath(value: string | null | undefined) {
  if (value === null) {
    return null;
  }

  const trimmed = value?.trim();
  return trimmed ? normalize(trimmed) : null;
}

export function normalizeAgentDataRoots(
  value: Partial<Record<keyof AgentDataRoots, string | null>>
): Partial<Record<keyof AgentDataRoots, string | null>> {
  const result: Partial<Record<keyof AgentDataRoots, string | null>> = {};

  for (const fieldName of ["codexHome", "claudeHome", "lmStudioHome"] as const) {
    if (!(fieldName in value)) {
      continue;
    }

    result[fieldName] = normalizeOptionalPath(value[fieldName]);
  }

  return result;
}

export function normalizeEndpoint(value: string) {
  const url = value.includes("://")
    ? new URL(value)
    : new URL(`http://${value}`);
  url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeOptionalEndpoint(value: string | null | undefined) {
  if (value === null) {
    return null;
  }

  const trimmed = value?.trim();
  return trimmed ? normalizeEndpoint(trimmed) : null;
}

export function normalizeRuntimeEndpoints(
  value: Partial<Record<keyof RuntimeEndpoints, string | null>>
): Partial<Record<keyof RuntimeEndpoints, string | null>> {
  const result: Partial<Record<keyof RuntimeEndpoints, string | null>> = {};

  for (const fieldName of ["ollamaEndpoint", "lmStudioEndpoint"] as const) {
    if (!(fieldName in value)) {
      continue;
    }

    result[fieldName] = normalizeOptionalEndpoint(value[fieldName]);
  }

  return result;
}

function normalizeOrigin(origin: string) {
  const url = new URL(origin);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function normalizeAllowedOrigins(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
        .map(normalizeOrigin)
    )
  );
}

function normalizePairingHostOrigin(host: string) {
  const url = host.includes("://")
    ? new URL(host)
    : new URL(`http://${host}`);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function normalizePairingHosts(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
        .map(normalizePairingHostOrigin)
    )
  );
}

export function normalizeStoredDaemonSettings(value: unknown): StoredDaemonSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const source = value as StoredDaemonSettings;
  const settings: StoredDaemonSettings = {};

  if (typeof source.authRequired === "boolean") {
    settings.authRequired = source.authRequired;
  }

  if (source.publicHost === null || typeof source.publicHost === "string") {
    settings.publicHost = normalizePublicHost(source.publicHost);
  }

  if (Array.isArray(source.allowedOrigins)) {
    settings.allowedOrigins = normalizeAllowedOrigins(source.allowedOrigins);
  }

  if (Array.isArray(source.pairingHosts)) {
    settings.pairingHosts = normalizePairingHosts(source.pairingHosts);
  }

  if (
    source.agentDataRoots &&
    typeof source.agentDataRoots === "object" &&
    !Array.isArray(source.agentDataRoots)
  ) {
    settings.agentDataRoots = normalizeAgentDataRoots(source.agentDataRoots);
  }

  if (
    source.runtimeEndpoints &&
    typeof source.runtimeEndpoints === "object" &&
    !Array.isArray(source.runtimeEndpoints)
  ) {
    settings.runtimeEndpoints = normalizeRuntimeEndpoints(source.runtimeEndpoints);
  }

  if (
    typeof source.storageMaxMb === "number" &&
    Number.isInteger(source.storageMaxMb) &&
    source.storageMaxMb >= 20 &&
    source.storageMaxMb <= 500
  ) {
    settings.storageMaxMb = source.storageMaxMb;
  } else if (
    typeof source.attachedSessionCacheMaxMb === "number" &&
    Number.isInteger(source.attachedSessionCacheMaxMb) &&
    source.attachedSessionCacheMaxMb >= 20 &&
    source.attachedSessionCacheMaxMb <= 500
  ) {
    settings.storageMaxMb = source.attachedSessionCacheMaxMb;
  }

  return settings;
}
