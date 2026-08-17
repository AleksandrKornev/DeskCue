import webPush from "web-push";

import type { StoredVapidKeys } from "../state/notificationTypes.ts";

export function configureWebPush(vapid: StoredVapidKeys) {
  webPush.setVapidDetails(
    "mailto:deskcue-local@example.invalid",
    vapid.publicKey,
    vapid.privateKey
  );
}

export function isStaleSubscriptionError(error: unknown) {
  return (
    typeof error === "object" && error !== null && "statusCode" in error &&
    (error.statusCode === 404 || error.statusCode === 410)
  );
}
