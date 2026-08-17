import type { AccessLinkResponse } from "@deskcue/protocol";

export function formatPairingReadiness(pairingLink: AccessLinkResponse) {
  if (pairingLink.warnings?.length) {
    return "Review warnings before opening this link";
  }

  if (pairingLink.lanReady === false) {
    return "This link may not be reachable from another device";
  }

  return "Open this link on another device or copy it to another browser";
}

export function formatPairingHostSourceLabel(
  hostSource: AccessLinkResponse["hostSource"],
  isCustomOrigin: boolean,
  isSavedOrigin: boolean
) {
  if (isSavedOrigin) {
    return "Saved Access host";
  }

  if (isCustomOrigin) {
    return "Custom one-off address";
  }

  if (hostSource === "public_host") {
    return "Configured public host";
  }

  if (hostSource === "lan_address") {
    return "Detected LAN address";
  }

  if (hostSource === "request_host") {
    return "Current browser host";
  }

  return "Generated address";
}

export function formatPairingHostSourceDescription(
  pairingLink: AccessLinkResponse,
  isCustomOrigin: boolean,
  isSavedOrigin: boolean
) {
  if (isSavedOrigin) {
    return "Uses a reusable address from the Access tab. Update that list there when your LAN IP, domain, VPN name, or proxy URL changes.";
  }

  if (isCustomOrigin) {
    return "Uses the address entered above for this one link. It must serve the DeskCue web app and route /api requests to this machine.";
  }

  if (pairingLink.hostSource === "public_host") {
    return "Uses the Public host setting from Access. This is the right mode for a domain, VPN hostname, HTTPS reverse proxy, or stable self-hosted URL.";
  }

  if (pairingLink.hostSource === "lan_address") {
    return "Uses a detected LAN address. It works only while the other device can reach this machine on the same network or VPN, and the IP can change.";
  }

  if (pairingLink.hostSource === "request_host") {
    return "Uses the host from this browser. If another device cannot open it, add a reachable Access host or Public host.";
  }

  return "If this address is not reachable from the other device, add a reachable Access host and create a new link.";
}

export function isLoopbackPairingLink(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}
