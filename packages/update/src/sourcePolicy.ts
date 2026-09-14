import { UpdateError } from "./errors.ts";

export const DEFAULT_UPDATE_REDIRECT_LIMIT = 5;

export type UpdateFetch = typeof fetch;

export type UpdateRequestPolicy = {
  allowedHosts: readonly string[];
  fetch?: UpdateFetch;
  maxRedirects?: number;
  signal?: AbortSignal;
  timeoutMs: number;
};

class UpdateRequestScope {
  private readonly controller = new AbortController();
  private readonly externalAbortListener: () => void;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private timeoutDurationMs: number | null = null;
  private timeoutTriggered = false;

  constructor(requestTimeoutMs: number, private readonly externalSignal?: AbortSignal) {
    this.externalAbortListener = this.handleExternalAbort.bind(this);
    externalSignal?.addEventListener("abort", this.externalAbortListener, { once: true });
    if (externalSignal?.aborted) this.handleExternalAbort();

    this.armTimeout(requestTimeoutMs);
  }

  get signal() {
    return this.controller.signal;
  }

  completeRequest() {
    this.clearTimeout();
  }

  dispose() {
    this.clearTimeout();
    this.externalSignal?.removeEventListener("abort", this.externalAbortListener);
  }

  startInactivityTimeout(timeoutMs: number) {
    this.timeoutDurationMs = timeoutMs;
    this.armTimeout(timeoutMs);
  }

  timedOut() {
    return this.timeoutTriggered;
  }

  touchTimeout() {
    if (this.timeoutDurationMs !== null) this.armTimeout(this.timeoutDurationMs);
  }

  private armTimeout(timeoutMs: number) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("Update timeout must be a positive integer.");
    }

    this.clearTimeout();
    this.timeout = setTimeout(() => {
      this.timeoutTriggered = true;
      this.controller.abort(new Error("Update request timed out."));
    }, timeoutMs);
    this.timeout.unref?.();
  }

  private clearTimeout() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
  }

  private handleExternalAbort() {
    this.controller.abort(this.externalSignal?.reason);
  }
}

function normalizeAllowedHosts(hosts: readonly string[]) {
  const normalized = new Set(
    hosts
      .map((host) => host.trim().toLocaleLowerCase("en-US"))
      .filter(Boolean)
  );

  if (normalized.size === 0) {
    throw new UpdateError("invalid_update_source", "At least one update release host must be allowed.");
  }

  return normalized;
}

export function assertAllowedUpdateUrl(value: string | URL, allowedHosts: readonly string[]) {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch (error) {
    throw new UpdateError("invalid_update_source", "Update source URL is invalid.", { cause: error });
  }

  const hosts = normalizeAllowedHosts(allowedHosts);
  const hostname = url.hostname.toLocaleLowerCase("en-US");

  if (url.protocol !== "https:") {
    throw new UpdateError("invalid_update_source", "Update sources must use HTTPS.");
  }

  if (url.username || url.password) {
    throw new UpdateError("invalid_update_source", "Update source URLs cannot contain credentials.");
  }

  if (!hosts.has(hostname)) {
    throw new UpdateError("invalid_update_source", `Update source host is not allowed: ${hostname}.`);
  }

  if (url.hash) {
    throw new UpdateError("invalid_update_source", "Update source URLs cannot contain fragments.");
  }

  return url;
}

function createRequestScope(timeoutMs: number, externalSignal?: AbortSignal) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Update request timeout must be a positive integer.");
  }

  return new UpdateRequestScope(timeoutMs, externalSignal);
}

function isRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function requestWithRedirects(
  initialUrl: URL,
  requestPolicy: UpdateRequestPolicy,
  signal: AbortSignal
) {
  const fetchImpl = requestPolicy.fetch ?? fetch;
  const maxRedirects = requestPolicy.maxRedirects ?? DEFAULT_UPDATE_REDIRECT_LIMIT;

  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new TypeError("Update redirect limit must be a non-negative integer.");
  }

  let currentUrl = initialUrl;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, {
      headers: {
        accept: "application/json, application/octet-stream"
      },
      redirect: "manual",
      signal
    });

    if (!isRedirectStatus(response.status)) return response;

    if (redirectCount >= maxRedirects) {
      await response.body?.cancel();
      throw new UpdateError("invalid_update_source", "Update source exceeded the redirect limit.");
    }

    const location = response.headers.get("location");

    await response.body?.cancel();

    if (!location) {
      throw new UpdateError("invalid_update_source", "Update redirect did not include a Location header.");
    }

    currentUrl = assertAllowedUpdateUrl(new URL(location, currentUrl), requestPolicy.allowedHosts);
  }
}

export async function fetchUpdateResponse(
  url: string | URL,
  requestPolicy: UpdateRequestPolicy
) {
  const initialUrl = assertAllowedUpdateUrl(url, requestPolicy.allowedHosts);
  const scope = createRequestScope(requestPolicy.timeoutMs, requestPolicy.signal);

  try {
    const response = await requestWithRedirects(initialUrl, requestPolicy, scope.signal);

    if (!response.ok) {
      await response.body?.cancel();
      throw new UpdateError("download_failed", `Update source returned HTTP ${response.status}.`);
    }

    scope.completeRequest();

    return {
      dispose: () => scope.dispose(),
      response,
      signal: scope.signal,
      startInactivityTimeout: (timeoutMs: number) => scope.startInactivityTimeout(timeoutMs),
      timedOut: () => scope.timedOut(),
      touchTimeout: () => scope.touchTimeout()
    };
  } catch (error) {
    scope.dispose();
    if (scope.timedOut()) {
      throw new UpdateError("timeout", "Update request timed out.", { cause: error });
    }

    if (requestPolicy.signal?.aborted) {
      throw new UpdateError("cancelled", "Update request was cancelled.", { cause: error });
    }

    if (error instanceof UpdateError) throw error;

    throw new UpdateError("download_failed", "Update request failed.", { cause: error });
  }
}
