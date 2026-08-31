import clsx from "clsx";
import { observer } from "mobx-react-lite";
import {
  useEffect,
  useRef,
  useState
} from "react";

import { useSettingsPageContext } from "@modules/settings/context";

import { NotificationDeliveryDiagnosticsPanel } from "./components/NotificationDeliveryDiagnosticsPanel/NotificationDeliveryDiagnosticsPanel";
import { NotificationProviderSettingsGrid } from "./components/NotificationProviderSettingsGrid";
import { NotificationRouteMatrix } from "./components/NotificationRouteMatrix";
import styles from "./styles.module.scss";

export const NotificationSettingsTab = observer(function NotificationSettingsTab() {
  const { notificationStore } = useSettingsPageContext();
  const draft = notificationStore.draft;
  const formRef = useRef<HTMLFormElement>(null);
  const operationFocusTargetRef = useRef<HTMLElement | null>(null);
  const completionFocusRequestedRef = useRef(false);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const savedStatusRef = useRef<HTMLParagraphElement>(null);
  const wasOperationPendingRef = useRef(false);
  const handledSaveSuccessRevisionRef = useRef(
    notificationStore.notificationSettingsSaveSuccessRevision
  );
  const [showSavedConfirmation, setShowSavedConfirmation] = useState(false);
  const showsCompactActionBar = showSavedConfirmation &&
    !notificationStore.notificationSettingsDirty &&
    !notificationStore.savingNotificationSettings;

  useEffect(() => {
    notificationStore.load();
  }, [notificationStore]);

  useEffect(() => {
    handledSaveSuccessRevisionRef.current =
      notificationStore.notificationSettingsSaveSuccessRevision;
    completionFocusRequestedRef.current = false;
    operationFocusTargetRef.current = null;
    wasOperationPendingRef.current = notificationStore.notificationSettingsOperationPending;
    setShowSavedConfirmation(false);
  }, [
    notificationStore,
    notificationStore.connectionRevision
  ]);

  useEffect(() => {
    const operationPending = notificationStore.notificationSettingsOperationPending;
    const wasOperationPending = wasOperationPendingRef.current;

    wasOperationPendingRef.current = operationPending;
    if (!wasOperationPending || operationPending) return;

    const activeElement = document.activeElement;
    const operationFocusTarget = operationFocusTargetRef.current;
    const focusStillOwnedByOperation =
      activeElement === document.body ||
      activeElement === operationFocusTarget;

    if (
      notificationStore.notificationSettingsSaveSuccessRevision !==
      handledSaveSuccessRevisionRef.current
    ) {
      completionFocusRequestedRef.current = focusStillOwnedByOperation;
      return;
    }

    operationFocusTargetRef.current = null;
    const focusTarget = operationFocusTarget?.isConnected &&
      !operationFocusTarget.matches(":disabled")
      ? operationFocusTarget
      : saveButtonRef.current;

    if (focusStillOwnedByOperation) focusTarget?.focus({ preventScroll: true });
  }, [
    notificationStore.notificationSettingsOperationPending,
    notificationStore.notificationSettingsSaveSuccessRevision
  ]);

  useEffect(() => {
    const successRevision = notificationStore.notificationSettingsSaveSuccessRevision;

    if (successRevision === handledSaveSuccessRevisionRef.current) return;

    handledSaveSuccessRevisionRef.current = successRevision;
    setShowSavedConfirmation(true);
  }, [notificationStore.notificationSettingsSaveSuccessRevision]);

  useEffect(() => {
    if (!showSavedConfirmation) return;

    const operationFocusTarget = operationFocusTargetRef.current;
    const focusTarget = operationFocusTarget?.isConnected &&
      !operationFocusTarget.matches(":disabled")
      ? operationFocusTarget
      : savedStatusRef.current ?? saveButtonRef.current;

    operationFocusTargetRef.current = null;
    if (completionFocusRequestedRef.current) focusTarget?.focus({ preventScroll: true });
    completionFocusRequestedRef.current = false;
  }, [showSavedConfirmation]);

  useEffect(() => {
    if (notificationStore.notificationSettingsDirty) setShowSavedConfirmation(false);
  }, [notificationStore.notificationSettingsDirty]);

  return (
    <article
      aria-labelledby="settings-tab-notifications"
      className={styles.card}
      id="settings-panel-notifications"
      role="tabpanel"
    >
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
          aria-busy={notificationStore.notificationSettingsOperationPending}
          aria-describedby="notification-settings-operation-status"
          className={styles.notificationSettingsForm}
          ref={formRef}
          onClickCapture={(event) => {
            if (notificationStore.notificationSettingsOperationPending) return;

            const target = event.target;

            if (!(target instanceof HTMLElement)) return;

            operationFocusTargetRef.current = target.closest<HTMLElement>(
              "button, input, select, textarea, [tabindex]"
            );
          }}
          onSubmit={(event) => {
            event.preventDefault();

            const submitter = event.nativeEvent instanceof SubmitEvent
              ? event.nativeEvent.submitter
              : null;
            const activeElement = document.activeElement;

            operationFocusTargetRef.current = submitter instanceof HTMLElement
              ? submitter
              : activeElement instanceof HTMLElement
                ? activeElement
                : null;
            void notificationStore.saveNotificationSettings();
          }}
        >
          <fieldset
            className={styles.notificationSettingsFields}
            disabled={notificationStore.notificationSettingsOperationPending}
          >
            <legend className={styles.srOnly}>Notification settings controls</legend>
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
            <label className={styles.toggleRow} htmlFor="notifications-enabled">
              <input
                aria-describedby="notifications-enabled-description"
                aria-labelledby="notifications-enabled-label"
                checked={draft.enabled}
                id="notifications-enabled"
                name="notifications-enabled"
                type="checkbox"
                onChange={(event) => notificationStore.setEnabled(event.target.checked)}
              />
              <span>
                <strong id="notifications-enabled-label">Enable notifications</strong>
                <small id="notifications-enabled-description">
                  Applies to all configured channels and event routes
                </small>
              </span>
            </label>

            <NotificationRouteMatrix />

            <NotificationProviderSettingsGrid />

            <NotificationDeliveryDiagnosticsPanel />
          </fieldset>

          {notificationStore.notificationSettingsDirty ||
          notificationStore.savingNotificationSettings ||
          showSavedConfirmation ? (
            <div
              className={clsx(
                styles.actions,
                showsCompactActionBar && styles.actionsClean
              )}
              data-settings-action-bar={showsCompactActionBar ? "compact" : "full"}
            >
              {notificationStore.notificationSettingsDirty ||
              notificationStore.savingNotificationSettings ? (
              <button
                className={styles.button}
                disabled={notificationStore.notificationSettingsOperationPending}
                ref={saveButtonRef}
                type="submit"
              >
                {notificationStore.savingNotificationSettings ? "Saving..." : "Save notifications"}
              </button>
              ) : (
                <p
                  className={styles.notificationSaveStatus}
                  ref={savedStatusRef}
                  tabIndex={-1}
                >
                  All notification changes saved
                </p>
              )}
            </div>
          ) : null}
        </form>
      )}
      <p
        aria-live="polite"
        className={styles.srOnly}
        id="notification-settings-operation-status"
      >
        {notificationStore.notificationSettingsOperationStatus}
      </p>
    </article>
  );
});
