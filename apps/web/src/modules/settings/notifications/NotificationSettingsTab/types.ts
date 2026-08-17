import type {
  NotificationEventKind,
  NotificationProviderKind,
  NotificationProviderSettings
} from "@deskcue/protocol";

export type NotificationSettingsDraft = {
  enabled: boolean;
  providers: NotificationProviderSettings & {
    gotify: NotificationProviderSettings["gotify"] & {
      token: string;
    };
    telegram: NotificationProviderSettings["telegram"] & {
      botToken: string;
    };
  };
  routes: Record<NotificationEventKind, NotificationProviderKind[]>;
};

export type NotificationEventOption = {
  description: string;
  event: NotificationEventKind;
  label: string;
};

export type NotificationProviderOption = {
  provider: NotificationProviderKind;
  label: string;
};

export type VisibleNotificationSecrets = {
  gotifyToken: boolean;
  telegramBotToken: boolean;
  webhookHeaders: boolean;
};

export type TelegramPairingState = {
  botUsername: string;
  code: string;
  deepLink: string;
  expiresAt: string;
} | null;
