import { api } from "./client";
import {
  readApiResult,
  readNullableRequestData,
  readRequestData
} from "./requestTransport";

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
