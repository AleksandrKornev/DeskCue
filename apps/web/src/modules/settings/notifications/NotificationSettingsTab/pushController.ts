import { notificationsApi } from "@api/endpoint/notifications/endpoints";

import {
  disablePushNotifications,
  enablePushNotifications,
  getPushClientId,
  readPushPermissionState,
  readPushSupportState
} from "./pushNotificationsService";

export const notificationPushController = {
  disablePushNotifications,
  enablePushNotifications,
  getPushClientId,
  getPushStatus: () => notificationsApi.getPushStatus(),
  listPushSubscriptions: (pushClientId: string) =>
    notificationsApi.listPushSubscriptions(pushClientId),
  readPushPermissionState,
  readPushSupportState,
  removePushSubscriptionById: (id: string) => notificationsApi.removePushSubscriptionById(id)
};

export type NotificationPushController = typeof notificationPushController;
