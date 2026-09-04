import { useId } from "react";
import type { ReactNode } from "react";

import type { NotificationProviderKind } from "@deskcue/protocol";
import styles from "@modules/settings/notifications/NotificationSettingsTab/styles.module.scss";

export function NotificationProviderCard({
  children,
  enabled,
  provider,
  testing,
  title,
  onEnabledChange,
  onSendTest
}: {
  children: ReactNode;
  enabled: boolean;
  provider: NotificationProviderKind;
  testing: boolean;
  title: string;
  onEnabledChange: (provider: NotificationProviderKind, enabled: boolean) => void;
  onSendTest: (provider: NotificationProviderKind) => void;
}) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className={styles.notificationProviderCard}>
      <div className={styles.providerHeader}>
        <label className={styles.providerToggle}>
          <input
            checked={enabled}
            name={`notification-provider-${provider}`}
            type="checkbox"
            onChange={(event) => onEnabledChange(provider, event.target.checked)}
          />
          <strong id={titleId}>{title}</strong>
        </label>
        <button
          className={styles.inlineButton}
          disabled={!enabled || testing}
          onClick={() => onSendTest(provider)}
          type="button"
        >
          {testing ? "Sending..." : "Send test"}
        </button>
      </div>
      {enabled ? <div className={styles.providerBody}>{children}</div> : null}
    </section>
  );
}
