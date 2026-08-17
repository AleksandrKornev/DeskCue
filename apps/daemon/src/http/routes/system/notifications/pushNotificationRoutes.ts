import type express from "express";

import type { PushNotificationService } from "#infrastructure/notifications/pushNotificationService";

import { installNotificationSettingsRoutes } from "./notificationSettingsRoutes.ts";
import { installPushSubscriptionRoutes } from "./pushSubscriptionRoutes.ts";

type PushNotificationRouteOptions = {
  pushNotifications: PushNotificationService;
};

export function installPushNotificationRoutes(
  app: express.Express,
  { pushNotifications }: PushNotificationRouteOptions
) {
  installPushSubscriptionRoutes(app, pushNotifications);
  installNotificationSettingsRoutes(app, pushNotifications);
}
