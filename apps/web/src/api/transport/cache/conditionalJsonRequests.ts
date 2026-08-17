import type { AxiosResponse } from "axios";

import { readConnectionEpoch } from "@api/connection/events";
import { api } from "@api/transport/client";
import { throwApiRequestError } from "@api/transport/requestFailure";
import { getDeskCueRuntime } from "@runtime";

import {
  buildConditionalJsonCacheKey,
  deleteConditionalJsonCacheEntry,
  isConditionalJsonCacheGenerationCurrent,
  readConditionalJsonCacheGeneration,
  readConditionalJsonCacheEntry,
  setConditionalJsonCacheEntry
} from "./conditionalJsonCache";

type GetApiOptions = {
  signal?: AbortSignal;
};

type PostApiOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

const MAX_CONNECTION_CHANGE_RETRIES = 2;

export type ConditionalJsonResult<TData> = {
  data: TData;
  etag: string | null;
  notModified: boolean;
  status: number;
};

function readHeaderValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === "string") ?? null;
  }

  return null;
}

function isConditionalSuccess(status: number) {
  return (status >= 200 && status < 300) || status === 304;
}

function cacheConditionalResponse<TData>(
  cacheKey: string,
  response: AxiosResponse<TData>,
  cacheGeneration: number
): ConditionalJsonResult<TData> {
  const etag = readHeaderValue(response.headers.etag);
  if (etag) {
    setConditionalJsonCacheEntry(cacheKey, { data: response.data, etag }, cacheGeneration);
  } else {
    deleteConditionalJsonCacheEntry(cacheKey, cacheGeneration);
  }

  return {
    data: response.data,
    etag,
    notModified: false,
    status: response.status
  };
}

async function getUncachedConditionalJsonResult<TData>(
  url: string,
  options: GetApiOptions | undefined,
  fallbackMessage: string,
  connectionChangeRetries = 0
): Promise<ConditionalJsonResult<TData>> {
  const cacheKey = buildConditionalJsonCacheKey(url);
  const generation = readConditionalJsonCacheGeneration();
  const requestEpoch = readConnectionEpoch();
  const requestRuntime = getDeskCueRuntime();
  try {
    const response = await api.get<TData>(url, { signal: options?.signal });
    if (!isConditionalJsonCacheGenerationCurrent(generation)) {
      if (connectionChangeRetries >= MAX_CONNECTION_CHANGE_RETRIES) {
        throw new Error("DeskCue connection kept changing while the request was in flight");
      }
      return getUncachedConditionalJsonResult(
        url,
        options,
        fallbackMessage,
        connectionChangeRetries + 1
      );
    }
    return cacheConditionalResponse(cacheKey, response, generation);
  } catch (error) {
    throwApiRequestError(error, fallbackMessage, requestEpoch, requestRuntime);
  }
}

async function postUncachedConditionalJsonResult<TData>(
  url: string,
  data: unknown,
  options: PostApiOptions | undefined,
  fallbackMessage: string
) {
  const cacheKey = buildConditionalJsonCacheKey(`POST ${url}`);
  const generation = readConditionalJsonCacheGeneration();
  const requestEpoch = readConnectionEpoch();
  const requestRuntime = getDeskCueRuntime();
  try {
    const response = await api.post<TData>(url, data, {
      signal: options?.signal,
      timeout: options?.timeoutMs
    });
    if (!isConditionalJsonCacheGenerationCurrent(generation)) {
      throw new Error("DeskCue connection changed while the request was in flight");
    }
    return cacheConditionalResponse(cacheKey, response, generation);
  } catch (error) {
    throwApiRequestError(error, fallbackMessage, requestEpoch, requestRuntime);
  }
}

export async function getConditionalJsonResult<TData>(
  url: string,
  fallbackMessage: string,
  options?: GetApiOptions
): Promise<ConditionalJsonResult<TData>> {
  const cacheKey = buildConditionalJsonCacheKey(url);
  const cacheGeneration = readConditionalJsonCacheGeneration();
  const requestEpoch = readConnectionEpoch();
  const requestRuntime = getDeskCueRuntime();
  const cached = readConditionalJsonCacheEntry<TData>(cacheKey);

  try {
    const response = await api.get<TData>(url, {
      headers: cached ? { "If-None-Match": cached.etag } : undefined,
      signal: options?.signal,
      validateStatus: isConditionalSuccess
    });

    if (!isConditionalJsonCacheGenerationCurrent(cacheGeneration)) {
      return getUncachedConditionalJsonResult<TData>(url, options, fallbackMessage);
    }

    if (response.status === 304) {
      if (cached) {
        return {
          data: cached.data,
          etag: cached.etag,
          notModified: true,
          status: response.status
        };
      }

      deleteConditionalJsonCacheEntry(cacheKey, cacheGeneration);
      return getUncachedConditionalJsonResult<TData>(url, options, fallbackMessage);
    }

    return cacheConditionalResponse(cacheKey, response, cacheGeneration);
  } catch (error) {
    throwApiRequestError(error, fallbackMessage, requestEpoch, requestRuntime);
  }
}

export async function getConditionalJson<TData>(
  url: string,
  fallbackMessage: string,
  options?: GetApiOptions
) {
  return (await getConditionalJsonResult<TData>(url, fallbackMessage, options)).data;
}

export async function postConditionalJsonResult<TData>(
  url: string,
  data: unknown,
  fallbackMessage: string,
  options?: PostApiOptions
): Promise<ConditionalJsonResult<TData>> {
  const cacheKey = buildConditionalJsonCacheKey(`POST ${url}`);
  const cacheGeneration = readConditionalJsonCacheGeneration();
  const requestEpoch = readConnectionEpoch();
  const requestRuntime = getDeskCueRuntime();
  const cached = readConditionalJsonCacheEntry<TData>(cacheKey);

  try {
    const response = await api.post<TData>(url, data, {
      headers: cached ? { "If-None-Match": cached.etag } : undefined,
      signal: options?.signal,
      timeout: options?.timeoutMs,
      validateStatus: isConditionalSuccess
    });

    if (!isConditionalJsonCacheGenerationCurrent(cacheGeneration)) {
      return postUncachedConditionalJsonResult<TData>(
        url,
        data,
        options,
        fallbackMessage
      );
    }

    if (response.status === 304) {
      if (cached) {
        return {
          data: cached.data,
          etag: cached.etag,
          notModified: true,
          status: response.status
        };
      }

      deleteConditionalJsonCacheEntry(cacheKey, cacheGeneration);
      return postUncachedConditionalJsonResult<TData>(
        url,
        data,
        options,
        fallbackMessage
      );
    }

    return cacheConditionalResponse(cacheKey, response, cacheGeneration);
  } catch (error) {
    throwApiRequestError(error, fallbackMessage, requestEpoch, requestRuntime);
  }
}
