import { observer } from "mobx-react-lite";
import { useEffect } from "react";

import { useSettingsPageContext } from "@modules/settings/context";

import { NotificationDeliveryDiagnosticsPanel } from "./components/NotificationDeliveryDiagnosticsPanel/NotificationDeliveryDiagnosticsPanel";
import { NotificationProviderSettingsGrid } from "./components/NotificationProviderSettingsGrid";
import { NotificationRouteMatrix } from "./components/NotificationRouteMatrix";
import styles from "./styles.module.scss";

export const NotificationSettingsTab = observer(function NotificationSettingsTab() {
  const { notificationStore } = useSettingsPageContext();
  const draft = notificationStore.draft;

  useEffect(() => {
    notificationStore.load();
  }, [notificationStore]);

  return (
    <article className={styles.card} role="tabpanel">
      <div className={styles.cardHeader}>
        <div>
          <span className={styles.label}>Notifications</span>
          <h2>Notification routing</h2>
          <p>Choose which events DeskCue sends and where they are delivered</p>
        </div>
      </div>

      {notificationStore.loadingNotificationSettings || !draft ? (
        <p className={styles.status}>Loading notification settings...</p>
      ) : (
        <form
          className={styles.notificationSettingsForm}
          onSubmit={(event) => {
            event.preventDefault();
            void notificationStore.saveNotificationSettings();
          }}
        >
          <input
            aria-hidden="true"
            autoComplete="username"
            className={styles.srOnly}
            name="notification-secret-context"
            readOnly
            tabIndex={-1}
            type="text"
            value="DeskCue notifications"
          />
          <div className={styles.toggleRow}>
            <input
              checked={draft.enabled}
              id="notifications-enabled"
              name="notifications-enabled"
              type="checkbox"
              onChange={(event) => notificationStore.setEnabled(event.target.checked)}
            />
            <span>
              <strong>Enable notifications</strong>
              <small>Applies to all configured channels and event routes</small>
            </span>
          </div>

          <NotificationRouteMatrix />

          <NotificationProviderSettingsGrid />

          <NotificationDeliveryDiagnosticsPanel />

          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={notificationStore.savingNotificationSettings}
              type="submit"
            >
              {notificationStore.savingNotificationSettings ? "Saving..." : "Save notifications"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
});
