import type express from "express";

import type { PushNotificationService } from "#infrastructure/notifications/pushNotificationService";

import {
  readNotificationTestInput,
  readTelegramPairingResolveInput,
  readTelegramPairingStartInput,
  readUpdateNotificationSettingsInput
} from "./notificationSettingsRouteInputs.ts";

export function installNotificationSettingsRoutes(
  app: express.Express,
  pushNotifications: PushNotificationService
) {
  app.get("/api/notifications/settings", (_request, response) => {
    response.json(pushNotifications.getNotificationSettings());
  });

  app.patch("/api/notifications/settings", async (request, response, next) => {
    try {
      response.json(await pushNotifications.updateNotificationSettings(
        readUpdateNotificationSettingsInput(request.body)
      ));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/notifications/test", async (request, response, next) => {
    try {
      const input = readNotificationTestInput(request.body);
      response.json(await pushNotifications.sendTestNotification(
        input.provider,
        input.settings
      ));
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/notifications/telegram/pairing/start",
    async (request, response, next) => {
      try {
        const input = readTelegramPairingStartInput(request.body);
        response.json(await pushNotifications.startTelegramPairing(input.settings));
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/api/notifications/telegram/pairing/resolve",
    async (request, response, next) => {
      try {
        const input = readTelegramPairingResolveInput(request.body);
        response.json(await pushNotifications.resolveTelegramPairing(input.code));
      } catch (error) {
        next(error);
      }
    }
  );
}
