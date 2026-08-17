import { observer } from "mobx-react-lite";

import { useSettingsPageContext } from "@modules/settings/context";
import { NotificationProviderCard } from "@modules/settings/notifications/NotificationSettingsTab/components/NotificationProviderCard";
import { NotificationSecretField } from "@modules/settings/notifications/NotificationSettingsTab/components/NotificationSecretField";
import { TelegramPairingControls } from "@modules/settings/notifications/NotificationSettingsTab/components/TelegramPairingControls";
import { WebPushProviderSettings } from "@modules/settings/notifications/NotificationSettingsTab/components/WebPushProviderSettings";
import styles from "@modules/settings/notifications/NotificationSettingsTab/styles.module.scss";

export const NotificationProviderSettingsGrid = observer(function NotificationProviderSettingsGrid() {
  const { notificationStore } = useSettingsPageContext();
  const draft = notificationStore.draft;

  if (!draft) {
    return null;
  }

  return (
    <div className={styles.notificationProviderGrid}>
      <NotificationProviderCard
        enabled={draft.providers.webPush.enabled}
        provider="web_push"
        testing={notificationStore.testingNotificationProvider === "web_push"}
        title="Web Push"
        onEnabledChange={notificationStore.setProviderEnabled}
        onSendTest={notificationStore.sendTest}
      >
        <WebPushProviderSettings
          currentPushSubscribed={notificationStore.currentPushSubscribed}
          disablingPush={notificationStore.disablingPush}
          effectivePushSupport={notificationStore.pushSupport}
          enablingPush={notificationStore.enablingPush}
          pushPermission={notificationStore.pushPermission}
          pushStatus={notificationStore.pushStatus}
          pushSummary={notificationStore.pushSummary}
          reenablingPush={notificationStore.reenablingPush}
          otherPushSubscriptions={notificationStore.otherPushSubscriptions}
          removingPushSubscriptionId={notificationStore.removingPushSubscriptionId}
          onDisablePush={notificationStore.disablePush}
          onEnablePush={notificationStore.enablePush}
          onReenablePush={notificationStore.reenablePush}
          onRemoveOtherPushSubscription={notificationStore.removeOtherPushSubscription}
        />
      </NotificationProviderCard>

      <NotificationProviderCard
        enabled={draft.providers.ntfy.enabled}
        provider="ntfy"
        testing={notificationStore.testingNotificationProvider === "ntfy"}
        title="ntfy"
        onEnabledChange={notificationStore.setProviderEnabled}
        onSendTest={notificationStore.sendTest}
      >
        <label className={styles.fieldLabel}>
          <span>Topic URL</span>
          <input
            autoComplete="off"
            className={styles.field}
            id="notification-ntfy-topic-url"
            name="notification-ntfy-topic-url"
            placeholder="https://ntfy.sh/deskcue-topic"
            value={draft.providers.ntfy.topicUrl}
            onChange={(event) => notificationStore.setProviderField("ntfy", "topicUrl", event.target.value)}
          />
        </label>
      </NotificationProviderCard>

      <NotificationProviderCard
        enabled={draft.providers.gotify.enabled}
        provider="gotify"
        testing={notificationStore.testingNotificationProvider === "gotify"}
        title="Gotify"
        onEnabledChange={notificationStore.setProviderEnabled}
        onSendTest={notificationStore.sendTest}
      >
        <label className={styles.fieldLabel}>
          <span>Server URL</span>
          <input
            autoComplete="off"
            className={styles.field}
            id="notification-gotify-server-url"
            name="notification-gotify-server-url"
            placeholder="https://gotify.example.com"
            value={draft.providers.gotify.serverUrl}
            onChange={(event) => notificationStore.setProviderField("gotify", "serverUrl", event.target.value)}
          />
        </label>
        <NotificationSecretField
          fieldId="notification-gotify-token"
          label="Gotify token"
          placeholder={notificationStore.notificationSettings?.providers.gotify.tokenConfigured ? "Configured; enter a new token to replace" : "Gotify app token"}
          secretKey="gotifyToken"
          value={draft.providers.gotify.token}
          visible={notificationStore.visibleNotificationSecrets.gotifyToken}
          onChange={(value) => notificationStore.setProviderField("gotify", "token", value)}
          onToggleVisibility={notificationStore.toggleSecretVisibility}
        />
      </NotificationProviderCard>

      <NotificationProviderCard
        enabled={draft.providers.telegram.enabled}
        provider="telegram"
        testing={notificationStore.testingNotificationProvider === "telegram"}
        title="Telegram"
        onEnabledChange={notificationStore.setProviderEnabled}
        onSendTest={notificationStore.sendTest}
      >
        <NotificationSecretField
          fieldId="notification-telegram-bot-token"
          label="Telegram bot token"
          placeholder={notificationStore.notificationSettings?.providers.telegram.botTokenConfigured ? "Configured; enter a new token to replace" : "123456:ABC..."}
          secretKey="telegramBotToken"
          value={draft.providers.telegram.botToken}
          visible={notificationStore.visibleNotificationSecrets.telegramBotToken}
          onChange={(value) => notificationStore.setProviderField("telegram", "botToken", value)}
          onToggleVisibility={notificationStore.toggleSecretVisibility}
        />
        <TelegramPairingControls
          resolvingTelegramPairing={notificationStore.resolvingTelegramPairing}
          startingTelegramPairing={notificationStore.startingTelegramPairing}
          telegramPairing={notificationStore.telegramPairing}
          onResolveTelegramPairing={notificationStore.resolveTelegramPairing}
          onStartTelegramPairing={notificationStore.startTelegramPairing}
        />
        <label className={styles.fieldLabel}>
          <span>Chat ID</span>
          <input
            autoComplete="off"
            className={styles.field}
            id="notification-telegram-chat-id"
            name="notification-telegram-chat-id"
            placeholder="123456789"
            value={draft.providers.telegram.chatId}
            onChange={(event) => notificationStore.setProviderField("telegram", "chatId", event.target.value)}
          />
        </label>
      </NotificationProviderCard>

      <NotificationProviderCard
        enabled={draft.providers.webhook.enabled}
        provider="webhook"
        testing={notificationStore.testingNotificationProvider === "webhook"}
        title="Custom webhook"
        onEnabledChange={notificationStore.setProviderEnabled}
        onSendTest={notificationStore.sendTest}
      >
        <label className={styles.fieldLabel}>
          <span>Webhook URL</span>
          <input
            autoComplete="off"
            className={styles.field}
            id="notification-webhook-url"
            name="notification-webhook-url"
            placeholder="https://example.com/deskcue-hook"
            value={draft.providers.webhook.url}
            onChange={(event) => notificationStore.setProviderField("webhook", "url", event.target.value)}
          />
        </label>
        <NotificationSecretField
          fieldId="notification-webhook-headers"
          helperText="One header per line, `Name: value`"
          label="Webhook headers"
          placeholder="Authorization: Bearer token"
          secretKey="webhookHeaders"
          textarea
          value={draft.providers.webhook.headersText}
          visible={notificationStore.visibleNotificationSecrets.webhookHeaders}
          onChange={(value) => notificationStore.setProviderField("webhook", "headersText", value)}
          onToggleVisibility={notificationStore.toggleSecretVisibility}
        />
      </NotificationProviderCard>
    </div>
  );
});
