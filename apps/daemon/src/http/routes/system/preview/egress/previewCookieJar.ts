import type { PreviewOwner } from "../previewTargetResolver.ts";

const MAX_COOKIE_JARS = 256;
const MAX_COOKIES_PER_JAR = 128;
const MAX_COOKIE_BYTES = 4 * 1024;

type StoredCookie = {
  domain: string;
  expiresAtMs: number | null;
  hostOnly: boolean;
  name: string;
  path: string;
  secure: boolean;
  value: string;
};

function parseCookieExpiry(value: string | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function defaultCookiePath(pathname: string) {
  if (!pathname.startsWith("/") || pathname === "/") return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

function normalizeCookiePath(value: string) {
  return value.startsWith("/") ? value : "/";
}

function parseCookie(value: string, target: URL, nowMs: number): StoredCookie | null {
  if (Buffer.byteLength(value) > MAX_COOKIE_BYTES) return null;
  const [pair = "", ...attributes] = value.split(";");
  const separator = pair.indexOf("=");
  if (separator <= 0) return null;
  const name = pair.slice(0, separator).trim();
  const cookieValue = pair.slice(separator + 1).trim();
  if (!name) return null;

  const parsedAttributes = new Map<string, string>();
  for (const entry of attributes) {
    const attributeSeparator = entry.indexOf("=");
    const key = (attributeSeparator < 0 ? entry : entry.slice(0, attributeSeparator))
      .trim()
      .toLowerCase();
    const attributeValue = attributeSeparator < 0 ? "" : entry.slice(attributeSeparator + 1).trim();
    if (key) parsedAttributes.set(key, attributeValue);
  }

  const hostname = target.hostname.toLowerCase();
  const requestedDomain = parsedAttributes.get("domain")?.replace(/^\./, "").toLowerCase();
  // Keep browser-equivalent domain isolation without maintaining a public
  // suffix database in the daemon. Parent-domain cookies are intentionally not
  // shared across egress origins; origin-specific SSO still works.
  if (requestedDomain && hostname !== requestedDomain) {
    return null;
  }
  const maxAge = Number(parsedAttributes.get("max-age"));
  const expiresAtMs = parsedAttributes.has("max-age") && Number.isFinite(maxAge)
    ? nowMs + maxAge * 1000
    : parseCookieExpiry(parsedAttributes.get("expires"));
  const path = normalizeCookiePath(
    parsedAttributes.get("path") ?? defaultCookiePath(target.pathname)
  );
  return {
    domain: hostname,
    expiresAtMs,
    hostOnly: true,
    name,
    path,
    secure: parsedAttributes.has("secure"),
    value: cookieValue
  };
}

function domainMatches(hostname: string, cookie: StoredCookie) {
  return cookie.hostOnly
    ? hostname === cookie.domain
    : hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`);
}

function pathMatches(pathname: string, cookiePath: string) {
  return (
    pathname === cookiePath ||
    pathname.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`)
  );
}

function buildJarKey(owner: PreviewOwner, viewerKey: string) {
  return `${owner.kind}:${owner.id}:${viewerKey}`;
}

export class PreviewCookieJar {
  private readonly jars = new Map<string, Map<string, StoredCookie>>();

  read(owner: PreviewOwner, viewerKey: string, target: URL, nowMs = Date.now()) {
    const jar = this.jars.get(buildJarKey(owner, viewerKey));
    if (!jar) return null;
    const hostname = target.hostname.toLowerCase();
    const cookies: StoredCookie[] = [];
    for (const [key, cookie] of jar) {
      if (cookie.expiresAtMs !== null && cookie.expiresAtMs <= nowMs) {
        jar.delete(key);
        continue;
      }
      if (
        domainMatches(hostname, cookie) &&
        pathMatches(target.pathname, cookie.path) &&
        (!cookie.secure || target.protocol === "https:")
      ) {
        cookies.push(cookie);
      }
    }
    cookies.sort((left, right) => right.path.length - left.path.length);
    const value = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    return value || null;
  }

  store(
    owner: PreviewOwner,
    viewerKey: string,
    target: URL,
    setCookies: string[] | undefined,
    nowMs = Date.now()
  ) {
    if (!setCookies?.length) return;
    const key = buildJarKey(owner, viewerKey);
    let jar = this.jars.get(key);
    if (!jar) {
      while (this.jars.size >= MAX_COOKIE_JARS) {
        const oldest = this.jars.keys().next().value;
        if (!oldest) break;
        this.jars.delete(oldest);
      }
      jar = new Map();
      this.jars.set(key, jar);
    }

    for (const value of setCookies) {
      const cookie = parseCookie(value, target, nowMs);
      if (!cookie) continue;
      const cookieKey = `${cookie.domain}\n${cookie.path}\n${cookie.name}`;
      if (cookie.expiresAtMs !== null && cookie.expiresAtMs <= nowMs) {
        jar.delete(cookieKey);
        continue;
      }
      if (jar.size >= MAX_COOKIES_PER_JAR && !jar.has(cookieKey)) continue;
      jar.set(cookieKey, cookie);
    }
  }

  clear() {
    this.jars.clear();
  }
}
