import type { SecurityStatusResponse } from "@deskcue/protocol";

export function readAccessExposureTitle(securityStatus: SecurityStatusResponse) {
  if (securityStatus.authRequired) {
    return "Pairing is required";
  }

  if (securityStatus.exposureLevel === "local_only") {
    return "Local access is open";
  }

  if (securityStatus.exposureLevel === "lan_exposed") {
    return "LAN access is open";
  }

  return "Public access is open";
}

export function readAccessExposureDetail(securityStatus: SecurityStatusResponse) {
  if (securityStatus.authRequired) {
    return "Browsers need a paired device token before they can control DeskCue.";
  }

  if (securityStatus.exposureLevel === "local_only") {
    return "Only this machine can reach DeskCue, but local processes can call the API.";
  }

  if (securityStatus.exposureLevel === "lan_exposed") {
    return "Devices that can reach this machine can control DeskCue until access protection is enabled.";
  }

  return "This address is not local. Treat it as reachable by untrusted clients until access protection is enabled.";
}
