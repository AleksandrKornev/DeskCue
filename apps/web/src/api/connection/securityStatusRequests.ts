import { isCompatibleProtocolMetadata } from "@deskcue/protocol";
import type { SecurityStatusResponse } from "@deskcue/protocol";
import { accessApi } from "@api/endpoint/access/endpoints";

import {
  API_UNAUTHORIZED_EVENT,
  CONNECTION_CONFIG_CHANGED_EVENT
} from "./events";

const SECURITY_STATUS_DEDUPE_HOLD_MS = 750;

let securityStatusRequest: Promise<SecurityStatusResponse> | null = null;
let securityStatusRequestStartedAt = 0;
let securityStatusRequestGeneration = 0;

export class ProtocolCompatibilityError extends Error {
  constructor(readonly receivedVersion: number) {
    super(`DeskCue protocol version ${receivedVersion} is incompatible with this dashboard.`);
    this.name = "ProtocolCompatibilityError";
  }
}

export function clearSecurityStatusRequest() {
  securityStatusRequestGeneration += 1;
  securityStatusRequest = null;
  securityStatusRequestStartedAt = 0;
}

if (typeof window !== "undefined") {
  window.addEventListener(API_UNAUTHORIZED_EVENT, clearSecurityStatusRequest);
  window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, clearSecurityStatusRequest);
}

export function fetchSecurityStatus() {
  const now = Date.now();
  if (
    securityStatusRequest &&
    now - securityStatusRequestStartedAt < SECURITY_STATUS_DEDUPE_HOLD_MS
  ) {
    return securityStatusRequest;
  }

  const generation = securityStatusRequestGeneration;
  securityStatusRequestStartedAt = now;
  const request = accessApi.getSecurityStatus().then((status) => {
    if (!isCompatibleProtocolMetadata(status.protocolVersion, status.protocolCapabilities)) {
      throw new ProtocolCompatibilityError(status.protocolVersion);
    }
    return status;
  }).finally(() => {
    globalThis.setTimeout(() => {
      if (
        generation === securityStatusRequestGeneration &&
        securityStatusRequest === request &&
        Date.now() - securityStatusRequestStartedAt >= SECURITY_STATUS_DEDUPE_HOLD_MS
      ) {
        securityStatusRequest = null;
      }
    }, SECURITY_STATUS_DEDUPE_HOLD_MS);
  });
  securityStatusRequest = request;

  return securityStatusRequest;
}

export function isProtocolCompatibilityError(error: unknown): error is ProtocolCompatibilityError {
  return error instanceof ProtocolCompatibilityError;
}
