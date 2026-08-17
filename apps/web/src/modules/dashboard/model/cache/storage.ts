import type { DashboardCache } from "@models/dashboardCache";
import { getDeskCueRuntime } from "@runtime";

import { mergeDashboardCache, sanitizeDashboardCache } from "./helpers";

const legacyDashboardCacheKey = "deskcue.dashboard.cache.v1";
const dashboardCacheKeyPrefix = "deskcue.dashboard.cache.v2";
const maxDashboardCacheBytes = 1_000_000;

export function buildDashboardCacheKey(scope: string) {
  return `${dashboardCacheKeyPrefix}:${encodeURIComponent(scope)}`;
}

function getDashboardCacheKey() {
  const scope = getDeskCueRuntime().getCacheScope();
  return scope ? buildDashboardCacheKey(scope) : null;
}

export function readDashboardCache(): DashboardCache {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const cacheKey = getDashboardCacheKey();
    window.sessionStorage.removeItem(legacyDashboardCacheKey);
    if (!cacheKey) {
      return {};
    }
    const rawValue = window.sessionStorage.getItem(cacheKey);
    if (!rawValue) {
      return {};
    }

    if (rawValue.length > maxDashboardCacheBytes) {
      window.sessionStorage.removeItem(cacheKey);
      return {};
    }

    return sanitizeDashboardCache(JSON.parse(rawValue) as DashboardCache);
  } catch {
    return {};
  }
}

export function writeDashboardCache(value: Record<string, unknown>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const cacheKey = getDashboardCacheKey();
    if (!cacheKey) {
      return;
    }
    const existing = readDashboardCache();
    const nextValue = mergeDashboardCache(
      existing,
      sanitizeDashboardCache(value)
    );
    const serialized = JSON.stringify(nextValue);
    if (serialized.length > maxDashboardCacheBytes) {
      window.sessionStorage.removeItem(cacheKey);
      return;
    }
    window.sessionStorage.setItem(cacheKey, serialized);
  } catch {
    // Ignore cache write failures and keep the live dashboard usable.
  }
}

export function clearDashboardCache() {
  if (typeof window !== "undefined") {
    const cacheKey = getDashboardCacheKey();
    if (cacheKey) {
      window.sessionStorage.removeItem(cacheKey);
    }
    window.sessionStorage.removeItem(legacyDashboardCacheKey);
  }
}

export function clearCloudMachineDashboardCaches() {
  if (typeof window === "undefined") {
    return;
  }
  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(`${dashboardCacheKeyPrefix}:cloud-machine%3A`)) {
      window.sessionStorage.removeItem(key);
    }
  }
}
