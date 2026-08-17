import type express from "express";

import {
  accessDeviceStore,
  buildDeviceLabel,
  getRequestAccessDevice,
  readRequestIp
} from "#access/accessDevices";
import {
  daemonConfig,
  readDaemonSettings,
  resetDaemonSettings,
  updateDaemonSettings
} from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

import { setAccessTokenCookie } from "./accessCookies.ts";
import { buildSecurityStatus } from "./securityStatus.ts";
import { readUpdateDaemonSettingsInput } from "../../middleware/validators.ts";

function buildBootstrapDaemonUrl(host: string) {
  if (host.includes("://")) {
    const url = new URL(host);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  }

  return `http://${host}:${daemonConfig.daemonPort}`;
}

function withAccessBootstrap(
  settings: ReturnType<typeof updateDaemonSettings>,
  request?: express.Request,
  response?: express.Response
) {
  if (!settings.authRequired || !request || getRequestAccessDevice(request)) {
    return settings;
  }

  const userAgent = request.get("user-agent") ?? null;
  const device = accessDeviceStore.createDevice({
    ip: readRequestIp(request),
    label: buildDeviceLabel(userAgent),
    userAgent
  });
  const host = settings.publicHost ?? request.hostname ?? "127.0.0.1";
  if (response) {
    setAccessTokenCookie(request, response, device.accessToken);
  }

  return {
    ...settings,
    accessToken: device.accessToken,
    daemonUrl: buildBootstrapDaemonUrl(host),
    deviceId: device.device.id
  };
}

export function installSecurityRoutes(app: express.Express) {
  app.get("/api/security/status", (_request, response) => {
    response.json(buildSecurityStatus());
  });

  app.get("/api/security/settings", (_request, response) => {
    response.json(readDaemonSettings());
  });

  app.patch("/api/security/settings", (request, response, next) => {
    try {
      const body = readUpdateDaemonSettingsInput(request.body);
      logger.warn("Daemon settings update requested", {
        fields: Object.keys(body)
      });
      response.json(withAccessBootstrap(updateDaemonSettings(body), request, response));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/security/settings", (_request, response) => {
    logger.warn("Daemon settings reset requested");
    response.json(withAccessBootstrap(resetDaemonSettings()));
  });
}
