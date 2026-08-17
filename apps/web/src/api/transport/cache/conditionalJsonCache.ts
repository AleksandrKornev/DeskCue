import {
  API_UNAUTHORIZED_EVENT,
  CONNECTION_CONFIG_CHANGED_EVENT
} from "@api/connection/events";
import { getDeskCueRuntime } from "@runtime";

export type ConditionalJsonCacheEntry<TData = unknown> = {
  data: TData;
  etag: string;
};

const CONDITIONAL_JSON_CACHE_LIMIT = 64;
const conditionalJsonCache = new Map<string, ConditionalJsonCacheEntry>();
const runtimeCacheScopes = new WeakMap<object, number>();
let nextRuntimeCacheScope = 1;
let conditionalJsonCacheGeneration = 0;

export function clearConditionalJsonCache() {
  conditionalJsonCacheGeneration += 1;
  conditionalJsonCache.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener(API_UNAUTHORIZED_EVENT, clearConditionalJsonCache);
  window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, clearConditionalJsonCache);
}

export function buildConditionalJsonCacheKey(key: string) {
  const runtime = getDeskCueRuntime();
  let scope = runtimeCacheScopes.get(runtime);
  if (scope === undefined) {
    scope = nextRuntimeCacheScope;
    nextRuntimeCacheScope += 1;
    runtimeCacheScopes.set(runtime, scope);
  }
  return `${scope}:${key}`;
}

export function readConditionalJsonCacheGeneration() {
  return conditionalJsonCacheGeneration;
}

export function isConditionalJsonCacheGenerationCurrent(generation: number) {
  return generation === conditionalJsonCacheGeneration;
}

export function readConditionalJsonCacheEntry<TData>(key: string) {
  const cached = conditionalJsonCache.get(key);
  if (!cached) {
    return null;
  }

  conditionalJsonCache.delete(key);
  conditionalJsonCache.set(key, cached);
  return cached as ConditionalJsonCacheEntry<TData>;
}

export function setConditionalJsonCacheEntry<TData>(
  key: string,
  cached: ConditionalJsonCacheEntry<TData>,
  expectedGeneration = conditionalJsonCacheGeneration
) {
  if (!isConditionalJsonCacheGenerationCurrent(expectedGeneration)) return;
  if (conditionalJsonCache.has(key)) {
    conditionalJsonCache.delete(key);
  }

  conditionalJsonCache.set(key, cached);

  while (conditionalJsonCache.size > CONDITIONAL_JSON_CACHE_LIMIT) {
    const oldestKey = conditionalJsonCache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }

    conditionalJsonCache.delete(oldestKey);
  }
}

export function deleteConditionalJsonCacheEntry(
  key: string,
  expectedGeneration = conditionalJsonCacheGeneration
) {
  if (!isConditionalJsonCacheGenerationCurrent(expectedGeneration)) return;
  conditionalJsonCache.delete(key);
}
