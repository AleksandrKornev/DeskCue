import { api } from "./client";
import {
  readApiResult,
  readNullableRequestData,
  readRequestData
} from "./requestTransport";

export const RANGED_BLOB_CHUNK_BYTES = 4 * 1024 * 1024 - (8 + 2 * 1024);
export const RANGED_BLOB_MAX_BYTES = 25 * 1024 * 1024;

type BlobByteRange = {
  end: number;
  start: number;
  total: number;
};

type ResponseHeaderReader = {
  get: (name: string) => unknown;
};

function isResponseHeaderReader(value: object): value is ResponseHeaderReader {
  return "get" in value && typeof value.get === "function";
}

function readResponseHeader(headers: unknown, name: string) {
  if (!headers || typeof headers !== "object") return null;

  const value = isResponseHeaderReader(headers)
    ? headers.get(name)
    : (headers as Record<string, unknown>)[name.toLowerCase()] ??
      (headers as Record<string, unknown>)[name];

  return typeof value === "string" ? value : null;
}

function parseBlobContentRange(value: string | null): BlobByteRange | null {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+)$/iu);

  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);

  if (![start, end, total].every(Number.isSafeInteger) || start > end || end >= total) return null;

  return { end, start, total };
}

function normalizeRangedBlobMaximumBytes(value: number | undefined) {
  if (value === undefined) return RANGED_BLOB_MAX_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Asset preview limit is invalid.");

  return Math.min(value, RANGED_BLOB_MAX_BYTES);
}

async function requestRangedBlob(
  url: string,
  signal: AbortSignal | undefined,
  maximumBytes: number
) {
  const parts: BlobPart[] = [];
  let contentType: string | null = null;
  let offset = 0;
  let total: number | null = null;

  while (total === null || offset < total) {
    signal?.throwIfAborted();
    const requestedEnd = Math.min(offset + RANGED_BLOB_CHUNK_BYTES - 1, maximumBytes - 1);
    const response = await api.get<Blob>(url, {
      headers: { Range: `bytes=${offset}-${requestedEnd}` },
      responseType: "blob",
      signal,
      validateStatus: (status) => status === 200 || status === 206 || status === 416
    });

    if (!(response.data instanceof Blob)) throw new Error("Asset response is not a blob.");

    if (response.status === 200) {
      if (offset !== 0 || response.data.size > maximumBytes) {
        throw new Error("Asset response exceeds the preview limit.");
      }

      return response.data;
    }

    if (
      response.status === 416 &&
      offset === 0 &&
      response.data.size === 0 &&
      readResponseHeader(response.headers, "content-range")?.toLowerCase() === "bytes */0"
    ) {
      const emptyContentType = readResponseHeader(response.headers, "content-type") ||
        response.data.type;

      return new Blob([], emptyContentType ? { type: emptyContentType } : undefined);
    }

    if (response.status !== 206) throw new Error("Asset range response is invalid.");

    const range = parseBlobContentRange(readResponseHeader(response.headers, "content-range"));
    const nextContentType = readResponseHeader(response.headers, "content-type") || response.data.type;
    const expectedEnd = range ? Math.min(requestedEnd, range.total - 1) : -1;

    if (!range || range.start !== offset || range.end !== expectedEnd ||
        response.data.size !== range.end - range.start + 1) {
      throw new Error("Asset range response is not contiguous.");
    }

    if (range.total > maximumBytes || (total !== null && range.total !== total)) {
      throw new Error("Asset response exceeds the preview limit.");
    }

    if (contentType !== null && nextContentType !== contentType) {
      throw new Error("Asset content type changed between ranges.");
    }

    contentType = nextContentType;
    total = range.total;
    offset = range.end + 1;
    parts.push(response.data);
  }

  return new Blob(parts, contentType ? { type: contentType } : undefined);
}

export { clearConditionalJsonCache } from "./cache/conditionalJsonCache";
export {
  getConditionalJson,
  getConditionalJsonResult,
  postConditionalJsonResult
} from "./cache/conditionalJsonRequests";
export type { ConditionalJsonResult } from "./cache/conditionalJsonRequests";

type GetApiOptions = {
  signal?: AbortSignal;
};

type PostApiOptions = {
  commandId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export function getJson<TData>(
  url: string,
  fallbackMessage: string,
  options?: GetApiOptions
) {
  return readRequestData(
    () => api.get<TData>(url, { signal: options?.signal }),
    fallbackMessage
  );
}

export function getText(
  url: string,
  fallbackMessage: string,
  options?: GetApiOptions
) {
  return readRequestData(
    () => api.get<string>(url, {
      responseType: "text",
      signal: options?.signal,
      transformResponse: [
        (value: unknown) => (typeof value === "string" ? value : "")
      ]
    }),
    fallbackMessage
  );
}

export function getBlob(
  url: string,
  fallbackMessage: string,
  options?: GetApiOptions
) {
  return readRequestData(
    () => api.get<Blob>(url, {
      responseType: "blob",
      signal: options?.signal
    }),
    fallbackMessage
  );
}

export function getRangedBlob(
  url: string,
  fallbackMessage: string,
  options?: GetApiOptions & { maximumBytes?: number }
) {
  return readRequestData(
    async () => ({
      data: await requestRangedBlob(
        url,
        options?.signal,
        normalizeRangedBlobMaximumBytes(options?.maximumBytes)
      ),
      status: 200
    }),
    fallbackMessage
  );
}

export function getNullableJson<TData>(
  url: string,
  fallbackMessage: string,
  options?: GetApiOptions
) {
  return readNullableRequestData(
    () => api.get<TData>(url, { signal: options?.signal }),
    fallbackMessage
  );
}

export function postApi<TData>(
  url: string,
  data?: unknown,
  options?: PostApiOptions
) {
  return readApiResult(
    () => api.post<TData>(url, data, {
      headers: options?.commandId
        ? { "X-DeskCue-Command-Id": options.commandId }
        : undefined,
      signal: options?.signal,
      timeout: options?.timeoutMs
    })
  );
}

export function postJson<TData>(
  url: string,
  data: unknown,
  fallbackMessage: string,
  options?: PostApiOptions
) {
  return readRequestData(
    () => api.post<TData>(url, data, {
      signal: options?.signal,
      timeout: options?.timeoutMs
    }),
    fallbackMessage
  );
}

export function patchJson<TData>(
  url: string,
  data: unknown,
  fallbackMessage: string
) {
  return readRequestData(() => api.patch<TData>(url, data), fallbackMessage);
}

export function patchApi<TData>(url: string, data?: unknown) {
  return readApiResult(() => api.patch<TData>(url, data));
}

export function deleteApi<TData>(url: string, data?: unknown) {
  return readApiResult(() => api.delete<TData>(url, { data }));
}

export function deleteJson<TData>(url: string, fallbackMessage: string) {
  return readRequestData(() => api.delete<TData>(url), fallbackMessage);
}
