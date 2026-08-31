import clsx from "clsx";
import { observer } from "mobx-react-lite";

import {
  formatBooleanValue,
  formatExposureLevel,
  formatOriginsValue,
  formatRiskLabel
} from "@modules/settings/access/AccessSettingsTab/helpers";
import styles from "@modules/settings/access/AccessSettingsTab/styles.module.scss";
import { useSettingsPageContext } from "@modules/settings/context";
import { SettingSourceDetails } from "@modules/settings/shared/SettingSourceDetails";

import { AccessProtectionSkeleton } from "./AccessProtectionSkeleton";
import { readAccessExposureDetail, readAccessExposureTitle } from "./helpers";

export const AccessProtectionPanel = observer(function AccessProtectionPanel() {
  const { accessStore } = useSettingsPageContext();
  const {
    daemonSettings,
    daemonSettingsDraft,
    daemonSettingsStatus,
    resettingDaemonSettings,
    savingDaemonSettings,
    securityStatus,
    securityStatusMessage,
    settingsMutationPending
  } = accessStore;

  return (
    <article className={clsx(styles.card, styles.accessProtectionCard)}>
      <div className={styles.cardHeader}>
        <div>
          <span className={styles.label}>Access</span>
          <h2>Access protection</h2>
          <p>
            {securityStatus
              ? securityStatus.summary
              : securityStatusMessage || "Checking security status..."}
          </p>
        </div>
        {securityStatus ? (
          <span className={clsx(styles.riskBadge, styles[`${securityStatus.riskLevel}Risk`])}>
            {formatRiskLabel(securityStatus.riskLevel)}
          </span>
        ) : null}
      </div>

      {!securityStatus ? (
        <AccessProtectionSkeleton />
      ) : (
        <>
          <div className={clsx(styles.accessExposureNotice, styles[`${securityStatus.riskLevel}ExposureNotice`])}>
            <strong>{readAccessExposureTitle(securityStatus)}</strong>
            <span>{readAccessExposureDetail(securityStatus)}</span>
          </div>

          <dl className={styles.securityGrid}>
            <div>
              <dt>Access protection</dt>
              <dd>{securityStatus.authRequired ? "On" : "Off"}</dd>
            </div>
            <div>
              <dt>Exposure</dt>
              <dd>{formatExposureLevel(securityStatus.exposureLevel)}</dd>
            </div>
            <div>
              <dt>Bind host</dt>
              <dd>{securityStatus.bindHost}</dd>
            </div>
            <div>
              <dt>Token source</dt>
              <dd>Device tokens</dd>
            </div>
            <div>
              <dt>Effective allowed origins</dt>
              <dd>
                {securityStatus.allowedOrigins.length > 0
                  ? securityStatus.allowedOrigins.join(", ")
                  : "Loopback/browser default"}
              </dd>
            </div>
          </dl>

          {securityStatus.warnings.length > 0 ? (
            <div className={clsx(styles.warningBox, styles[`${securityStatus.riskLevel}Warning`])}>
              {securityStatus.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          {daemonSettings && daemonSettingsDraft ? (
            <form
              className={clsx(styles.settingsForm, styles.accessProtectionForm)}
              onSubmit={(event) => {
                event.preventDefault();
                accessStore.onSaveDaemonSettings();
              }}
            >
              <div className={styles.formHeader}>
                <div>
                  <h3>Editable settings</h3>
                  <p>Saved locally; web values override environment defaults</p>
                </div>
                <span className={styles.filePath}>{daemonSettings.settingsFilePath}</span>
              </div>

              <label className={styles.toggleRow}>
                <input
                  aria-describedby="daemon-auth-required-help"
                  aria-labelledby="daemon-auth-required-label"
                  checked={daemonSettingsDraft.authRequired}
                  type="checkbox"
                  onChange={(event) => {
                    accessStore.onAuthRequiredChange(event.target.checked);
                  }}
                />
                <span>
                  <strong id="daemon-auth-required-label">Require access token</strong>
                  <small id="daemon-auth-required-help">
                    Protects the HTTP API and WebSocket after save
                  </small>
                </span>
              </label>
              <SettingSourceDetails
                source={daemonSettings.sources.authRequired}
                valueFormatter={formatBooleanValue}
              />

              <label className={styles.fieldLabel}>
                <span>Configured allowed origins</span>
                <textarea
                  className={clsx(styles.field, styles.textArea)}
                  id="daemon-allowed-origins"
                  name="allowedOrigins"
                  placeholder="https://deskcue.example.com"
                  value={daemonSettingsDraft.allowedOriginsText}
                  onChange={(event) => {
                    accessStore.onAllowedOriginsTextChange(event.target.value);
                  }}
                />
                <small>
                  Saved origins only. One origin per line or comma-separated.
                </small>
              </label>
              <SettingSourceDetails
                source={daemonSettings.sources.allowedOrigins}
                valueFormatter={formatOriginsValue}
              />

              <div className={styles.actions} data-settings-action-bar>
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
                <button
                  className={clsx(styles.button, styles.dangerButton)}
                  disabled={settingsMutationPending}
                  onClick={accessStore.onResetDaemonSettings}
                  type="button"
                >
                  {resettingDaemonSettings ? "Resetting..." : "Reset to env"}
                </button>
                <button
                  className={styles.button}
                  disabled={settingsMutationPending}
                  type="submit"
                >
                  {savingDaemonSettings ? "Saving..." : "Save settings"}
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </article>
  );
});
