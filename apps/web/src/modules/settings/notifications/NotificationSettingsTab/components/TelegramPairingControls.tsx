import { formatTelegramPairingExpiry } from "@modules/settings/notifications/NotificationSettingsTab/helpers";
import styles from "@modules/settings/notifications/NotificationSettingsTab/styles.module.scss";
import type { TelegramPairingState } from "@modules/settings/notifications/NotificationSettingsTab/types";

export function TelegramPairingControls({
  resolvingTelegramPairing,
  startingTelegramPairing,
  telegramPairing,
  onResolveTelegramPairing,
  onStartTelegramPairing
}: {
  resolvingTelegramPairing: boolean;
  startingTelegramPairing: boolean;
  telegramPairing: TelegramPairingState;
  onResolveTelegramPairing: () => void;
  onStartTelegramPairing: () => void;
}) {
  return (
    <div className={styles.telegramPairing}>
      <div className={styles.telegramPairingActions}>
        <button
          className={styles.inlineButton}
          disabled={startingTelegramPairing}
          onClick={onStartTelegramPairing}
          type="button"
        >
          {startingTelegramPairing ? "Opening..." : "Open Telegram"}
        </button>
        <button
          className={styles.inlineButton}
          disabled={!telegramPairing || resolvingTelegramPairing}
          onClick={onResolveTelegramPairing}
          type="button"
        >
          {resolvingTelegramPairing ? "Finding..." : "Find chat"}
        </button>
      </div>
      {telegramPairing ? (
        <small>
          Waiting for /start from @{telegramPairing.botUsername}; code expires {formatTelegramPairingExpiry(telegramPairing.expiresAt)}
        </small>
      ) : (
        <small>Open the bot, press Start, then find the chat automatically. Manual Chat ID still works.</small>
      )}
    </div>
  );
}
