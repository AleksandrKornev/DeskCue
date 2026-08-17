import type express from "express";
import net from "node:net";

import {
  DEFAULT_DAEMON_PORT,
  parsePairAccessInput,
  parseRedeemAccessRecoveryCodeInput,
  parseUpdateAccessDeviceInput
} from "@deskcue/protocol";
import type {
  AccessLinkResponse,
  AccessLinkStatusResponse,
  CreateAccessRecoveryCodeResponse,
  PairAccessResponse
} from "@deskcue/protocol";
import {
  accessDeviceStore,
  buildDeviceLabel,
  getRequestAccessDevice,
  readRequestIp
} from "#access/accessDevices";
import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

import { readRequestToken } from "./accessControl.ts";
import { clearAccessTokenCookie, setAccessTokenCookie } from "./accessCookies.ts";
import { PairingAttemptLimiter, PairingTickets } from "./pairingTickets.ts";
import { isTrustedLoopbackBrowserRequest } from "../../hostClient.ts";
import { findLanIPv4Address, isLoopbackHost } from "../../networkHosts.ts";

const pairingTickets = new PairingTickets();
const pairingAttemptLimiter = new PairingAttemptLimiter();
type AccessLinkTarget = "local" | "device";
type AccessLinkHostSource = NonNullable<AccessLinkResponse["hostSource"]>;

function readIncludeRevokedAccessDevices(request: express.Request) {
  const value = Array.isArray(request.query.includeRevoked)
    ? request.query.includeRevoked[0]
    : request.query.includeRevoked;
  return value === "1" || value === "true";
}

function revokeOtherAccessDevices(request: express.Request) {
  return accessDeviceStore.revokeOtherDevices(
    getRequestAccessDevice(request)?.id ?? null,
    {
      revokeAllWhenNoCurrentDevice: isTrustedLoopbackBrowserRequest(request)
    }
  );
}

function readPairingClientKey(request: express.Request) {
  return request.socket.remoteAddress ?? request.ip ?? "unknown";
}

function buildAccessLinkWarnings(target: AccessLinkTarget, host: string) {
  if (target !== "device") {
    return [];
  }

  const warnings: string[] = [];

  if (isLoopbackHost(host)) {
    warnings.push("Device link uses a loopback host; set Public host or use a LAN address");
  }

  if (isLoopbackHost(daemonConfig.bindHost)) {
    warnings.push("DeskCue is bound to loopback; set DESKCUE_BIND_HOST=0.0.0.0 before opening this link from another device");
  }

  return warnings;
}

function defaultPortForProtocol(protocol: string) {
  if (protocol === "https:") {
    return 443;
  }

  if (protocol === "http:") {
    return 80;
  }

  return null;
}

function readPortFromHeaderUrl(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.port ? Number(url.port) : defaultPortForProtocol(url.protocol);
  } catch {
    return null;
  }
}

function readBrowserFacingWebPort(request: express.Request) {
  const originPort = readPortFromHeaderUrl(request.get("origin"));
  if (originPort !== null) {
    return originPort;
  }

  return readPortFromHeaderUrl(request.get("referer")) ?? daemonConfig.daemonPort;
}

function formatHostForUrl(host: string) {
  return net.isIPv6(host) && !host.startsWith("[") ? `[${host}]` : host;
}

function buildOriginUrl(host: string, port: number) {
  const hasExplicitScheme = host.includes("://");
  const url = new URL(hasExplicitScheme ? host : `http://${formatHostForUrl(host)}`);
  url.pathname = "";
  url.search = "";
  url.hash = "";

  if (!url.port && !hasExplicitScheme) {
    url.port = String(port || DEFAULT_DAEMON_PORT);
  }

  return url.toString().replace(/\/$/, "");
}

function buildWebUrl(request: express.Request, host: string, pairCode: string) {
  const url = new URL(buildOriginUrl(host, readBrowserFacingWebPort(request)));
  url.pathname = `/pair/${encodeURIComponent(pairCode)}`;

  return url.toString();
}

function buildDaemonUrl(host: string) {
  return buildOriginUrl(host, daemonConfig.daemonPort);
}

function selectAccessLinkHost(
  request: express.Request,
  target: AccessLinkTarget
): { host: string; source: AccessLinkHostSource } {
  if (daemonConfig.publicHost) {
    return {
      host: daemonConfig.publicHost,
      source: "public_host"
    };
  }

  if (target === "device") {
    const lanAddress = findLanIPv4Address();
    if (lanAddress) {
      return {
        host: lanAddress,
        source: "lan_address"
      };
    }
  }

  return {
    host: request.hostname,
    source: "request_host"
  };
}

function readAccessLinkTarget(request: express.Request): AccessLinkTarget {
  return request.query.target === "device" || request.query.target === "mobile" ? "device" : "local";
}

export function canCreateAccessLink(request: express.Request) {
  return isTrustedLoopbackBrowserRequest(request) || Boolean(getRequestAccessDevice(request));
}

export function installAccessRoutes(app: express.Express) {
  app.get("/api/access/link", (request, response) => {
    if (!canCreateAccessLink(request)) {
      logger.warn("Access link request rejected for non-host client", {
        ip: request.socket.remoteAddress ?? request.ip ?? null
      });
      response.status(403).json({
        error: "Access links are only available from this computer or a paired DeskCue device."
      });
      return;
    }

    const target = readAccessLinkTarget(request);
    const selectedHost = selectAccessLinkHost(request, target);
    const daemonUrl = buildDaemonUrl(selectedHost.host);
    const pairCode = pairingTickets.create();
    const webUrl = buildWebUrl(request, selectedHost.host, pairCode);
    const warnings = buildAccessLinkWarnings(target, selectedHost.host);
    const payload: AccessLinkResponse = {
      daemonUrl,
      hostSource: selectedHost.source,
      lanReady: target === "device" ? warnings.length === 0 : true,
      pairCode,
      warnings,
      webUrl
    };

    response.json(payload);
  });

  app.get("/api/access/link/:pairCode/status", (request, response) => {
    const payload: AccessLinkStatusResponse = {
      status: pairingTickets.status(request.params.pairCode)
    };

    response.json(payload);
  });

  app.post("/api/access/pair", (request, response) => {
    if (!pairingAttemptLimiter.take(readPairingClientKey(request))) {
      logger.warn("Pairing attempt rate limit exceeded", {
        ip: request.socket.remoteAddress ?? request.ip ?? null
      });
      response.status(429).json({
        error: "Too many pairing attempts. Try again later."
      });
      return;
    }

    const body = parsePairAccessInput(request.body);
    if (!pairingTickets.consume(body.code)) {
      logger.warn("Pairing attempt rejected", {
        ip: request.socket.remoteAddress ?? request.ip ?? null
      });
      response.status(401).json({
        error: "Pairing code is invalid or expired."
      });
      return;
    }

    const userAgent = request.get("user-agent") ?? null;
    const device = accessDeviceStore.createDevice({
      ip: readRequestIp(request),
      label: buildDeviceLabel(userAgent),
      userAgent
    });
    const host = selectAccessLinkHost(request, "local").host;
    const payload: PairAccessResponse = {
      accessToken: device.accessToken,
      daemonUrl: buildDaemonUrl(host),
      deviceId: device.device.id
    };

    setAccessTokenCookie(request, response, device.accessToken);
    response.json(payload);
  });

  app.post("/api/access/recovery-codes", (_request, response) => {
    const recoveryCode = accessDeviceStore.createRecoveryCode();
    const payload: CreateAccessRecoveryCodeResponse = recoveryCode;
    response.json(payload);
  });

  app.post("/api/access/recover", (request, response) => {
    if (!pairingAttemptLimiter.take(readPairingClientKey(request))) {
      logger.warn("Recovery code attempt rate limit exceeded", {
        ip: request.socket.remoteAddress ?? request.ip ?? null
      });
      response.status(429).json({
        error: "Too many recovery attempts. Try again later."
      });
      return;
    }

    const body = parseRedeemAccessRecoveryCodeInput(request.body);
    const userAgent = request.get("user-agent") ?? null;
    const device = accessDeviceStore.redeemRecoveryCode({
      code: body.code,
      ip: readRequestIp(request),
      userAgent
    });

    if (!device) {
      logger.warn("Recovery code attempt rejected", {
        ip: request.socket.remoteAddress ?? request.ip ?? null
      });
      response.status(401).json({
        error: "Recovery code is invalid, expired, or already used."
      });
      return;
    }

    const host = selectAccessLinkHost(request, "local").host;
    const payload: PairAccessResponse = {
      accessToken: device.accessToken,
      daemonUrl: buildDaemonUrl(host),
      deviceId: device.device.id
    };

    setAccessTokenCookie(request, response, device.accessToken);
    response.json(payload);
  });

  app.post("/api/access/reset", (request, response) => {
    response.json(revokeOtherAccessDevices(request));
  });

  app.get("/api/access/devices", (request, response) => {
    const currentDevice = getRequestAccessDevice(request);
    const includeRevoked = readIncludeRevokedAccessDevices(request);
    response.json({
      currentAccess: {
        authRequired: daemonConfig.authRequired,
        credentialPresented: Boolean(readRequestToken(request)),
        deviceId: currentDevice?.id ?? null,
        trustedHost: isTrustedLoopbackBrowserRequest(request)
      },
      devices: accessDeviceStore.listDevices(currentDevice?.id ?? null, { includeRevoked }).devices
    });
  });

  app.delete("/api/access/devices/current", (request, response) => {
    clearAccessTokenCookie(request, response);
    response.json(accessDeviceStore.revokeCurrentDevice(getRequestAccessDevice(request)?.id ?? null));
  });

  app.delete("/api/access/devices/:deviceId", (request, response) => {
    response.json(accessDeviceStore.revokeDevice(
      request.params.deviceId,
      getRequestAccessDevice(request)?.id ?? null
    ));
  });

  app.patch("/api/access/devices/:deviceId", (request, response) => {
    const body = parseUpdateAccessDeviceInput(request.body);
    const result = accessDeviceStore.updateDeviceLabel(
      request.params.deviceId,
      body.label,
      getRequestAccessDevice(request)?.id ?? null
    );

    if (!result) {
      response.status(404).json({
        error: "Access device was not found."
      });
      return;
    }

    response.json(result);
  });

  app.post("/api/access/devices/revoke-others", (request, response) => {
    const result = revokeOtherAccessDevices(request);
    logger.warn("Access devices revoked", {
      currentDeviceId: getRequestAccessDevice(request)?.id ?? null,
      revokedCount: result.revokedCount
    });
    response.json(result);
  });
}
