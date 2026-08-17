import { observer } from "mobx-react-lite";

import { useSettingsPageContext } from "@modules/settings/context";
import styles from "@modules/settings/notifications/NotificationSettingsTab/styles.module.scss";

export const NotificationRouteMatrix = observer(function NotificationRouteMatrix() {
  const { notificationStore } = useSettingsPageContext();
  const draft = notificationStore.draft;

  if (!draft) {
    return null;
  }

  return (
    <div className={styles.notificationMatrix}>
      <div className={styles.notificationMatrixHeader}>
        <span>Event</span>
        {notificationStore.providerOptions.map((provider) => (
          <span key={provider.provider}>{provider.label}</span>
        ))}
      </div>
      {notificationStore.eventOptions.map((eventOption) => (
        <div className={styles.notificationMatrixRow} key={eventOption.event}>
          <div>
            <strong>{eventOption.label}</strong>
            <small>{eventOption.description}</small>
          </div>
          {notificationStore.providerOptions.map((providerOption) => (
            <label key={providerOption.provider}>
              <input
                checked={(draft.routes[eventOption.event] ?? []).includes(providerOption.provider)}
                name={`notification-route-${eventOption.event}-${providerOption.provider}`}
                type="checkbox"
                onChange={(event) => {
                  notificationStore.toggleRoute(
                    eventOption.event,
                    providerOption.provider,
                    event.target.checked
                  );
                }}
              />
              <span>{providerOption.label}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
});
