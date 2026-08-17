import { observer } from "mobx-react-lite";

import { useSettingsPageContext } from "@modules/settings/context";
import styles from "@modules/settings/notifications/NotificationSettingsTab/styles.module.scss";

import {
  formatAttemptSummary,
  isFailureUnresolved,
  readAttemptTone
} from "./helpers";
import { NotificationDiagnosticMetric } from "./NotificationDiagnosticMetric";

export const NotificationDeliveryDiagnosticsPanel = observer(
  function NotificationDeliveryDiagnosticsPanel() {
    const { notificationStore } = useSettingsPageContext();
    const diagnostics = notificationStore.deliveryDiagnostics;

    if (!diagnostics) {
      return null;
    }

    const hasUnresolvedFailure = isFailureUnresolved(
      diagnostics.lastFailure,
      diagnostics.lastSuccess
    );

    return (
      <section className={styles.deliveryDiagnostics}>
        <div className={styles.deliveryDiagnosticsHeader}>
          <div>
            <span className={styles.label}>Delivery diagnostics</span>
            <h3>Provider delivery</h3>
          </div>
          <button
            className={styles.inlineButton}
            disabled={notificationStore.refreshingNotificationDiagnostics}
            onClick={notificationStore.refreshNotificationDiagnostics}
            type="button"
          >
            {notificationStore.refreshingNotificationDiagnostics ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className={styles.deliveryDiagnosticsGrid}>
          <NotificationDiagnosticMetric
            label="Pending retries"
            value={String(diagnostics.pendingRetries)}
          />
          <NotificationDiagnosticMetric
            label="Last success"
            value={formatAttemptSummary(diagnostics.lastSuccess)}
          />
          <NotificationDiagnosticMetric
            label="Last failure"
            tone={hasUnresolvedFailure ? "warning" : "neutral"}
            value={formatAttemptSummary(diagnostics.lastFailure)}
          />
          <NotificationDiagnosticMetric
            label="Last attempt"
            tone={readAttemptTone(diagnostics.lastAttempt)}
            value={formatAttemptSummary(diagnostics.lastAttempt)}
          />
        </div>

        {hasUnresolvedFailure && diagnostics.lastFailure?.error ? (
          <p className={styles.deliveryDiagnosticsError}>
            {diagnostics.lastFailure.error}
          </p>
        ) : null}
      </section>
    );
  }
);
