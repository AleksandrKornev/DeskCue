import clsx from "clsx";
import { observer } from "mobx-react-lite";
import { Link } from "react-router";

import { useSettingsPageContext } from "@modules/settings/context";

import { AgentDataRootsSection } from "./components/AgentDataRootsSection";
import { RuntimeEndpointsSection } from "./components/RuntimeEndpointsSection";
import { ServiceStatusSummary } from "./components/ServiceStatusSummary";
import styles from "./styles.module.scss";

export const SystemSettingsTab = observer(function SystemSettingsTab() {
  const { systemStore } = useSettingsPageContext();
  const { daemonSettings, daemonSettingsDraft, daemonSettingsStatus } = systemStore;

  return (
    <article className={styles.card} role="tabpanel">
      <div className={styles.cardHeader}>
        <div>
          <span className={styles.label}>System</span>
          <h2>DeskCue service</h2>
          <p>Service status and diagnostic tools for this local DeskCue instance</p>
        </div>
      </div>
      <ServiceStatusSummary />

      {daemonSettings && daemonSettingsDraft ? (
        <form
          className={styles.settingsForm}
          onSubmit={(event) => {
            event.preventDefault();
            systemStore.onSaveDaemonSettings();
          }}
        >
          <AgentDataRootsSection />

          <RuntimeEndpointsSection />

          <div className={styles.actions}>
            {daemonSettingsStatus?.kind === "error" ? (
              <span
                className={clsx(
                  styles.saveStatus,
                  styles.saveStatusError
                )}
              >
                {daemonSettingsStatus.message}
              </span>
            ) : null}
            <button
              className={clsx(styles.button, styles.dangerButton)}
              onClick={systemStore.onResetDaemonSettings}
              type="button"
            >
              Reset to env
            </button>
            <button
              className={styles.button}
              type="submit"
            >
              Save settings
            </button>
          </div>
        </form>
      ) : null}

      <div className={styles.actions}>
        <Link className={styles.button} to="/logs">
          Open system logs
        </Link>
      </div>
    </article>
  );
});
