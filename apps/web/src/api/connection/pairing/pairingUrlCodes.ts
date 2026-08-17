import { safelyDecodeUriComponent } from "@lib/url";

export function readPairCodeFromPath(pathname: string) {
  const match = /^\/pair\/([^/]+)\/?$/.exec(pathname);
  return match ? safelyDecodeUriComponent(match[1]) : null;
}

export function readRecoveryCodeFromPath(pathname: string) {
  const match = /^\/recover\/([^/]+)\/?$/.exec(pathname);
  return match ? safelyDecodeUriComponent(match[1]) : null;
}

export function clearPairingQueryParams() {
  const url = new URL(window.location.href);
  const isPairPath = Boolean(readPairCodeFromPath(url.pathname));
  const isRecoveryPath = Boolean(readRecoveryCodeFromPath(url.pathname));
  url.searchParams.delete("deskcueDaemon");
  url.searchParams.delete("daemon");
  url.searchParams.delete("deskcuePair");
  url.searchParams.delete("pair");
  url.searchParams.delete("deskcueRecovery");
  url.searchParams.delete("recovery");
  url.searchParams.delete("deskcueToken");
  url.searchParams.delete("token");
  window.history.replaceState(
    null,
    "",
    `${isPairPath || isRecoveryPath ? "/" : url.pathname}${url.search}${url.hash}`
  );
}
