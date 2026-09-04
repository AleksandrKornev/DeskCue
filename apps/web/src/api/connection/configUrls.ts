import { DEFAULT_DAEMON_PORT } from "@deskcue/protocol";

export function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function buildLocalDaemonUrl(hostname: string) {
  if (!isLoopbackHost(hostname)) {
    return null;
  }

  const host = hostname === "::1" ? "[::1]" : hostname || "127.0.0.1";

  return `http://${host}:${DEFAULT_DAEMON_PORT}`;
}

export function buildSameOriginDaemonUrl(location: Location) {
  return `${location.protocol}//${location.host}`;
}

export function buildPageDaemonUrl(location: Location) {
  if (isLoopbackHost(location.hostname)) {
    return null;
  }

  return buildSameOriginDaemonUrl(location);
}

export function chooseDaemonUrlForPage(storedDaemonUrl: string | null, pageDaemonUrl: string | null) {
  if (!pageDaemonUrl) {
    return storedDaemonUrl;
  }

  return pageDaemonUrl;
}

export function normalizeDaemonUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;

    url.pathname = "";

    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function collectNormalizedDaemonUrls(values: Array<string | null>) {
  const urls = new Set<string>();

  for (const value of values) {
    const url = normalizeDaemonUrl(value);

    if (url) urls.add(url);
  }

  return urls;
}

export function readFirstNormalizedDaemonUrl(values: Array<string | null>) {
  for (const value of values) {
    const url = normalizeDaemonUrl(value);

    if (url) return url;
  }

  return null;
}

export function normalizeToken(value: string | null) {
  const token = value?.trim();

  return token || null;
}

export function collectNormalizedTokens(values: Array<string | null>) {
  const tokens = new Set<string>();

  for (const value of values) {
    const token = normalizeToken(value);

    if (token) tokens.add(token);
  }

  return tokens;
}

export function readFirstNormalizedToken(values: Array<string | null>) {
  for (const value of values) {
    const token = normalizeToken(value);

    if (token) return token;
  }

  return null;
}

export function isLoopbackDaemonUrl(value: string) {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function isSameOriginDaemonUrl(value: string) {
  try {
    return new URL(value).origin === window.location.origin;
  } catch {
    return false;
  }
}
