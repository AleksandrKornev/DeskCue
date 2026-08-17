import { toast } from "sonner";

import { notificationsApi } from "@api/endpoint/notifications/endpoints";

export const notificationSettingsController = {
  getSettings: () => notificationsApi.getSettings(),
  notifyError: (message: string) => toast.error(message),
  notifyInfo: (message: string) => toast.info(message),
  notifySuccess: (message: string) => toast.success(message),
  openExternal: (url: string) => window.open(url, "_blank", "noopener,noreferrer"),
  resolveTelegramPairing: (code: string) => notificationsApi.resolveTelegramPairing(code),
  sendTest: (...args: Parameters<typeof notificationsApi.sendTest>) =>
    notificationsApi.sendTest(...args),
  startTelegramPairing: (...args: Parameters<typeof notificationsApi.startTelegramPairing>) =>
    notificationsApi.startTelegramPairing(...args),
  updateSettings: (...args: Parameters<typeof notificationsApi.updateSettings>) =>
    notificationsApi.updateSettings(...args)
};

export type NotificationSettingsController = typeof notificationSettingsController;
