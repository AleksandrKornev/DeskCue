import clsx from "clsx";
import { observer } from "mobx-react-lite";
import {
  useEffect,
  useRef,
  useState
} from "react";
import { Link } from "react-router";

import { useSettingsPageContext } from "@modules/settings/context";

import { AgentDataRootsSection } from "./components/AgentDataRootsSection";
import { RuntimeEndpointsSection } from "./components/RuntimeEndpointsSection";
import { ServiceStatusSummary } from "./components/ServiceStatusSummary";
import styles from "./styles.module.scss";

export const SystemSettingsTab = observer(function SystemSettingsTab() {
  const { systemStore } = useSettingsPageContext();
  const { daemonSettings, daemonSettingsDraft, daemonSettingsStatus } = systemStore;
  const handledSaveSuccessRevisionRef = useRef(systemStore.settingsSaveSuccessRevision);
  const completionFocusRequestedRef = useRef(false);
  const operationFocusTargetRef = useRef<HTMLElement | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const savedStatusRef = useRef<HTMLParagraphElement>(null);
  const [showSavedConfirmation, setShowSavedConfirmation] = useState(false);
  const showsCompactActionBar = showSavedConfirmation &&
    !systemStore.systemSettingsDirty &&
    !systemStore.savingDaemonSettings;
  const showsActionBar = systemStore.systemSettingsDirty ||
    systemStore.savingDaemonSettings ||
    daemonSettingsStatus?.kind === "error" ||
    showSavedConfirmation;

  useEffect(() => {
    handledSaveSuccessRevisionRef.current = systemStore.settingsSaveSuccessRevision;
    completionFocusRequestedRef.current = false;
    operationFocusTargetRef.current = null;
    setShowSavedConfirmation(false);
  }, [systemStore, systemStore.settingsConnectionRevision]);

  useEffect(() => {
    const successRevision = systemStore.settingsSaveSuccessRevision;

    if (successRevision === handledSaveSuccessRevisionRef.current) return;

    handledSaveSuccessRevisionRef.current = successRevision;
    setShowSavedConfirmation(true);
  }, [systemStore.settingsSaveSuccessRevision]);

  useEffect(() => {
    if (!showSavedConfirmation || systemStore.savingDaemonSettings) return;

    const operationFocusTarget = operationFocusTargetRef.current;
    const activeElement = document.activeElement;
    const focusStillOwnedByOperation =
      activeElement === document.body || activeElement === operationFocusTarget;

    if (
      !systemStore.systemSettingsDirty &&
      completionFocusRequestedRef.current &&
      focusStillOwnedByOperation
    ) {
      savedStatusRef.current?.focus({ preventScroll: true });
    }

    completionFocusRequestedRef.current = false;
    operationFocusTargetRef.current = null;
  }, [
    showSavedConfirmation,
    systemStore.savingDaemonSettings,
    systemStore.systemSettingsDirty
  ]);

  useEffect(() => {
    if (systemStore.systemSettingsDirty) setShowSavedConfirmation(false);
  }, [systemStore.systemSettingsDirty]);

  return (
    <article
      aria-labelledby="settings-tab-system"
      className={styles.card}
      id="settings-panel-system"
      role="tabpanel"
    >
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
            operationFocusTargetRef.current = saveButtonRef.current;
            completionFocusRequestedRef.current = document.activeElement === operationFocusTargetRef.current;
            systemStore.onSaveDaemonSettings();
          }}
        >
          <AgentDataRootsSection />

          <RuntimeEndpointsSection />

          {showsActionBar ? (
            <div
              className={clsx(
                styles.actions,
                styles.systemActionBar,
                showsCompactActionBar && styles.actionsClean
              )}
              data-settings-action-bar={showsCompactActionBar ? "compact" : "full"}
            >
              {daemonSettingsStatus?.kind === "error" ? (
                <span
                  className={clsx(
                    styles.saveStatus,
                    styles.saveStatusError
                  )}
                  role="alert"
                >
                  {daemonSettingsStatus.message}
                </span>
              ) : null}
              {systemStore.systemSettingsDirty || systemStore.savingDaemonSettings ? (
                <button
                  className={styles.button}
                  disabled={systemStore.systemSettingsOperationPending}
                  ref={saveButtonRef}
                  type="submit"
                >
                  {systemStore.savingDaemonSettings ? "Saving..." : "Save settings"}
                </button>
              ) : showSavedConfirmation ? (
                <p
                  className={styles.systemSaveStatus}
                  ref={savedStatusRef}
                  role="status"
                  tabIndex={-1}
                >
                  All system changes saved
                </p>
              ) : null}
            </div>
          ) : null}
        </form>
      ) : null}

      <div className={clsx(styles.actions, styles.systemUtilities)}>
        <button
          className={clsx(styles.button, styles.dangerButton)}
          disabled={systemStore.systemSettingsOperationPending}
          onClick={systemStore.onResetDaemonSettings}
          type="button"
        >
          {systemStore.resettingDaemonSettings ? "Resetting..." : "Reset to env"}
        </button>
        <Link className={styles.button} to="/logs">
          Open system logs
        </Link>
      </div>
    </article>
  );
});
