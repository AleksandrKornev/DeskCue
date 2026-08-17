import type { SessionDetail } from "@deskcue/protocol";
import {
  API_UNAUTHORIZED_EVENT,
  CONNECTION_CONFIG_CHANGED_EVENT
} from "@api/connection/events";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import type { FetchSessionView } from "@api/endpoint/sessions/types";
import type { ConditionalJsonResult } from "@api/transport/requests";

type ManagedSessionDetailRequestOptions = {
  cacheTtlMs?: number;
  debugLogTail?: number;
  force?: boolean;
  sessionView?: FetchSessionView;
};

type ManagedSessionDetailCacheEntry = {
  cachedAt: number;
  result: ConditionalJsonResult<SessionDetail | null>;
};

const DEFAULT_MANAGED_SESSION_DETAIL_CACHE_TTL_MS = 1_000;
const MAX_MANAGED_SESSION_DETAIL_CACHE_ENTRIES = 16;

const inFlightManagedSessionDetailRequests = new Map<
  string,
  Promise<ConditionalJsonResult<SessionDetail | null>>
>();
const managedSessionDetailCache = new Map<string, ManagedSessionDetailCacheEntry>();
let managedSessionDetailCacheGeneration = 0;

export function clearManagedSessionDetailRequestCache() {
  managedSessionDetailCacheGeneration += 1;
  inFlightManagedSessionDetailRequests.clear();
  managedSessionDetailCache.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener(API_UNAUTHORIZED_EVENT, clearManagedSessionDetailRequestCache);
  window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, clearManagedSessionDetailRequestCache);
}

function buildManagedSessionDetailRequestKey(
  sessionId: string,
  options: ManagedSessionDetailRequestOptions
) {
  return JSON.stringify({
    debugLogTail: options.debugLogTail ?? null,
    sessionId,
    view: options.sessionView ?? null
  });
}

function readFreshManagedSessionDetailCache(
  requestKey: string,
  options: ManagedSessionDetailRequestOptions
) {
  const cached = managedSessionDetailCache.get(requestKey);
  if (!cached) {
    return null;
  }

  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_MANAGED_SESSION_DETAIL_CACHE_TTL_MS;
  if (Date.now() - cached.cachedAt > cacheTtlMs) {
    managedSessionDetailCache.delete(requestKey);
    return null;
  }

  managedSessionDetailCache.delete(requestKey);
  managedSessionDetailCache.set(requestKey, cached);
  return cached;
}

function setManagedSessionDetailCache(
  requestKey: string,
  entry: ManagedSessionDetailCacheEntry
) {
  managedSessionDetailCache.delete(requestKey);
  managedSessionDetailCache.set(requestKey, entry);

  while (managedSessionDetailCache.size > MAX_MANAGED_SESSION_DETAIL_CACHE_ENTRIES) {
    const oldestKey = managedSessionDetailCache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }

    managedSessionDetailCache.delete(oldestKey);
  }
}

export function fetchManagedSessionDetailWithMeta(
  sessionId: string,
  options: ManagedSessionDetailRequestOptions = {}
) {
  if (!sessionId) {
    return Promise.resolve({
      data: null,
      etag: null,
      notModified: false,
      status: 404
    } satisfies ConditionalJsonResult<SessionDetail | null>);
  }

  const requestKey = buildManagedSessionDetailRequestKey(sessionId, options);
  if (!options.force) {
    const cached = readFreshManagedSessionDetailCache(requestKey, options);
    if (cached) {
      return Promise.resolve(cached.result);
    }

    const inFlight = inFlightManagedSessionDetailRequests.get(requestKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const requestGeneration = managedSessionDetailCacheGeneration;
  const request = sessionsApi.getOneWithMeta(sessionId, {
    debugLogTail: options.debugLogTail,
    view: options.sessionView
  })
    .then((result) => {
      if (requestGeneration === managedSessionDetailCacheGeneration) {
        setManagedSessionDetailCache(requestKey, {
          cachedAt: Date.now(),
          result
        });
      }
      return result;
    })
    .finally(() => {
      if (inFlightManagedSessionDetailRequests.get(requestKey) === request) {
        inFlightManagedSessionDetailRequests.delete(requestKey);
      }
    });

  if (!options.force) {
    inFlightManagedSessionDetailRequests.set(requestKey, request);
  }

  return request;
}

export function fetchManagedSessionDetail(
  sessionId: string,
  options: ManagedSessionDetailRequestOptions = {}
) {
  return fetchManagedSessionDetailWithMeta(sessionId, options).then((result) => result.data);
}

export const clearManagedSessionDetailRequestCacheForTests =
  clearManagedSessionDetailRequestCache;
