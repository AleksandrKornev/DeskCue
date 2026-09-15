import { isIP } from "node:net";
import type { LookupFunction } from "node:net";

export const PREVIEW_LOOPBACK_HOSTNAME = "localhost";
const PREVIEW_LOOPBACK_ADDRESSES = [
  { address: "127.0.0.1", family: 4 },
  { address: "::1", family: 6 }
] as const;

export const lookupPreviewLoopback: LookupFunction = (hostname, options, callback) => {
  if (hostname.toLowerCase() !== PREVIEW_LOOPBACK_HOSTNAME) {
    const error = new Error("Preview loopback lookup rejected a non-loopback hostname.") as NodeJS.ErrnoException;

    error.code = "ENOTFOUND";
    callback(error, "", 0);
    return;
  }

  const family = typeof options === "number" ? options : options.family;
  const addresses = family === 4 || family === "IPv4"
    ? PREVIEW_LOOPBACK_ADDRESSES.slice(0, 1)
    : family === 6 || family === "IPv6"
      ? PREVIEW_LOOPBACK_ADDRESSES.slice(1)
      : [...PREVIEW_LOOPBACK_ADDRESSES];

  if (typeof options !== "number" && options.all) {
    callback(null, addresses);
    return;
  }

  const [address] = addresses;

  callback(null, address.address, address.family);
};

export const PREVIEW_LOOPBACK_CONNECT_OPTIONS = {
  autoSelectFamily: true,
  lookup: lookupPreviewLoopback
} as const;

export function resolvePreviewConnectionOptions(
  targetUrl: URL,
  egress: boolean,
  lookup: LookupFunction | undefined
) {
  if (lookup) return { lookup };
  if (!egress) return PREVIEW_LOOPBACK_CONNECT_OPTIONS;

  const hostname = targetUrl.hostname.replace(/^\[|\]$/gu, "");

  if (isIP(hostname)) return {};

  throw new Error("Preview egress hostname is missing its pinned lookup.");
}

export function buildPreviewLoopbackOrigin(port: number) {
  return `http://${PREVIEW_LOOPBACK_HOSTNAME}:${port}`;
}
