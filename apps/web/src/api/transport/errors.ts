import axios from "axios";

import type { ExternalDesktopInterruptFallback } from "@deskcue/protocol";

export type ApiErrorPayload = {
  code?: string;
  error?: string;
};

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return Boolean(value && typeof value === "object" && "error" in value);
}

export class ApiUnauthorizedError extends Error {
  constructor(message = "DeskCue access token is required") {
    super(message);
    this.name = "ApiUnauthorizedError";
  }
}

export class ApiHttpStatusError extends Error {
  readonly payload: ApiErrorPayload;
  readonly status: number;

  constructor(status: number, message: string, payload: ApiErrorPayload = {}) {
    super(message);
    this.name = "ApiHttpStatusError";
    this.payload = payload;
    this.status = status;
  }
}

export function isApiUnauthorizedError(error: unknown) {
  return error instanceof ApiUnauthorizedError;
}

export function isApiHttpStatusError(error: unknown) {
  return error instanceof ApiHttpStatusError;
}

export function hasApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return isApiErrorPayload(value);
}

export function readApiErrorMessage(value: unknown, fallbackMessage: string) {
  return hasApiErrorPayload(value) ? value.error ?? fallbackMessage : fallbackMessage;
}

export function isExternalDesktopInterruptUnavailable(value: unknown) {
  return (
    hasApiErrorPayload(value) &&
    value.code === "external_desktop_interrupt_unavailable"
  );
}

export function isExternalDesktopInterruptFallback(
  value: unknown
): value is ExternalDesktopInterruptFallback {
  return Boolean(
    value &&
    typeof value === "object" &&
    "kind" in value &&
    "code" in value &&
    (value as { kind?: unknown }).kind === "external_desktop_fallback" &&
    (value as { code?: unknown }).code === "external_desktop_interrupt_unavailable"
  );
}

export function isAxiosStatus(error: unknown, status: number) {
  return axios.isAxiosError(error) && error.response?.status === status;
}

export function readAxiosStatus(error: unknown) {
  return axios.isAxiosError(error) ? error.response?.status ?? null : null;
}

export function isApiRequestCanceled(error: unknown) {
  return axios.isCancel(error) || (axios.isAxiosError(error) && error.code === "ERR_CANCELED");
}

export function readAxiosErrorPayload(error: unknown): ApiErrorPayload {
  if (!axios.isAxiosError<unknown>(error)) {
    return {
      error: "Request failed"
    };
  }

  const responseData = error.response?.data;
  if (isApiErrorPayload(responseData)) {
    return responseData;
  }

  if (typeof responseData === "string" && responseData.trim()) {
    return {
      error: responseData.trim()
    };
  }

  return {
    error: error.message || "Request failed"
  };
}

export function readAxiosErrorMessage(error: unknown, fallbackMessage: string) {
  if (!axios.isAxiosError<unknown>(error)) {
    return fallbackMessage;
  }

  const responseData = error.response?.data;
  if (isApiErrorPayload(responseData) && responseData.error) {
    return responseData.error;
  }

  if (typeof responseData === "string" && responseData.trim()) {
    return responseData.trim();
  }

  return error.message || fallbackMessage;
}
