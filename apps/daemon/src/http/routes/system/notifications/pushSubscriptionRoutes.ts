import type express from "express";

import { getRequestAccessDevice } from "#access/accessDevices";
import { AppError } from "#application/errors";
import type { PushNotificationService } from "#infrastructure/notifications/pushNotificationService";

import {
  readOptionalEndpoint,
  readOptionalPushClientId,
  readPushSubscription,
  readPushSubscriptionId
} from "./pushSubscriptionRouteInputs.ts";

function readRequestBody(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function installPushSubscriptionRoutes(
  app: express.Express,
  pushNotifications: PushNotificationService
) {
  app.get("/api/push/status", (_request, response) => {
    response.json(pushNotifications.getStatus());
  });

  app.get("/api/push/vapid-public-key", (_request, response) => {
    response.json({
      publicKey: pushNotifications.getPublicKey()
    });
  });

  app.post("/api/push/subscriptions", async (request, response, next) => {
    try {
      const body = readRequestBody(request.body as unknown);
      const subscription = readPushSubscription(body.subscription);
      const pushClientId = readOptionalPushClientId(body.pushClientId);
      const replaceEndpoint = readOptionalEndpoint(body.replaceEndpoint);
      const registered = await pushNotifications.registerSubscription({
        accessDeviceId: getRequestAccessDevice(request)?.id ?? null,
        pushClientId,
        replaceEndpoint,
        subscription,
        userAgent: request.get("user-agent") ?? null
      });

      response.status(201).json({
        subscriptionCount: pushNotifications.getStatus().subscriptionCount,
        subscriptionId: registered.id
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/push/subscriptions", (request, response, next) => {
    try {
      response.json(pushNotifications.listSubscriptions({
        accessDeviceId: getRequestAccessDevice(request)?.id ?? null,
        pushClientId: readOptionalPushClientId(request.query.pushClientId)
      }));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/push/subscriptions/:id", async (request, response, next) => {
    try {
      const subscriptionId = readPushSubscriptionId(request.params.id);
      const removed = await pushNotifications.removeSubscriptionById(subscriptionId);
      if (!removed) {
        throw new AppError("not_found", "Push subscription was not found.");
      }

      response.json(removed);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/push/subscriptions", async (request, response, next) => {
    try {
      const body = readRequestBody(request.body as unknown);
      const endpoint = readOptionalEndpoint(body.endpoint);
      const pushClientId = readOptionalPushClientId(body.pushClientId);
      const accessDeviceId = getRequestAccessDevice(request)?.id ?? null;

      if (!endpoint && !pushClientId && !accessDeviceId) {
        throw new AppError(
          "invalid_input",
          "Push subscription endpoint or client id is required."
        );
      }

      response.json(await pushNotifications.removeSubscription({
        accessDeviceId,
        endpoint,
        pushClientId
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/push/test", async (_request, response, next) => {
    try {
      response.json(await pushNotifications.sendTestPush());
    } catch (error) {
      next(error);
    }
  });
}
