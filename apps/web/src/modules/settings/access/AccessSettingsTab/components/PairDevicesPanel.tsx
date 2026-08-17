import clsx from "clsx";
import { observer } from "mobx-react-lite";

import { buildCurrentDaemonAccessSettingsUrl } from "@api/connection";
import { PairingHostsDisclosure } from "@modules/settings/access/AccessSettingsTab/components/PairingHostsDisclosure";
import { formatPairingActionSummary } from "@modules/settings/access/AccessSettingsTab/helpers";
import styles from "@modules/settings/access/AccessSettingsTab/styles.module.scss";
import { AccessDeviceList } from "@modules/settings/access/components/AccessDeviceList";
import { formatDeviceDate } from "@modules/settings/access/components/AccessDeviceList/helpers";
import { useSettingsPageContext } from "@modules/settings/context";

export const PairDevicesPanel = observer(function PairDevicesPanel() {
  const { accessStore } = useSettingsPageContext();
  const accessSettingsUrl = buildCurrentDaemonAccessSettingsUrl();
  const {
    accessDevices,
    accessStatus,
    accessStatusKind,
    creatingPairingLink,
    creatingRecoveryCode,
    currentAccess,
    daemonSettings,
    forgettingCurrentBrowser,
    loadingAccessDevices,
    recoveryCode,
    renamingAccessDeviceId,
    resettingOtherTokens,
    revokingAccessDeviceId
  } = accessStore;

  return (
    <article className={styles.card} role="tabpanel">
      <div className={styles.cardHeader}>
        <div>
          <span className={styles.label}>Access</span>
          <h2>Pair devices</h2>
          <p>Create one-time pairing links or revoke old access tokens for this machine</p>
        </div>
      </div>
      <div className={styles.pairingActionPanel}>
        <div>
          <span className={styles.label}>Pair a device</span>
          <strong>Create a one-time link</strong>
          <small>{formatPairingActionSummary(daemonSettings?.pairingHosts ?? [])}</small>
        </div>
        <button
          className={styles.button}
          disabled={creatingPairingLink}
          onClick={accessStore.createPairingLink}
          type="button"
        >
          {creatingPairingLink ? "Creating..." : "Create device link"}
        </button>
      </div>
      <div className={styles.recoveryPanel}>
        <div>
          <span className={styles.label}>Remote recovery</span>
          <strong>Recovery code</strong>
          <small>
            Use this if a paired browser loses access while you are away. It can pair one new browser and is shown only once.
          </small>
        </div>
        <button
          className={styles.button}
          disabled={creatingRecoveryCode}
          onClick={accessStore.createRecoveryCode}
          type="button"
        >
          {creatingRecoveryCode ? "Creating..." : "Create recovery code"}
        </button>
        {recoveryCode ? (
          <div className={styles.recoveryCodePanel}>
            <span className={styles.label}>Save this code now</span>
            <code>{recoveryCode.code}</code>
            <small>
              Expires {formatDeviceDate(recoveryCode.expiresAt)}. Open DeskCue with <strong>?recovery=&lt;code&gt;</strong> or <strong>/recover/&lt;code&gt;</strong>.
            </small>
            <button
              className={styles.inlineButton}
              onClick={accessStore.copyRecoveryCode}
              type="button"
            >
              Copy code
            </button>
          </div>
        ) : null}
      </div>
      <PairingHostsDisclosure />
      <AccessDeviceList
        currentAccess={currentAccess}
        devices={accessDevices}
        forgettingCurrentBrowser={forgettingCurrentBrowser}
        loading={loadingAccessDevices}
        renamingDeviceId={renamingAccessDeviceId}
        resettingOtherTokens={resettingOtherTokens}
        revokingDeviceId={revokingAccessDeviceId}
        onForgetCurrentBrowser={accessStore.forgetCurrentBrowser}
        onRenameDevice={accessStore.renameAccessDevice}
        onRevokeDevice={accessStore.revokeAccessDevice}
        onRevokeOtherDevices={accessStore.resetOtherAccessTokens}
      />
      <div className={styles.accessHelpPanel}>
        <span className={styles.label}>Recovery fallback</span>
        <strong>Device lost access?</strong>
        <small>Create a device link from any paired browser. If every device is locked out, open the host page below</small>
        <code>{accessSettingsUrl}</code>
      </div>
      {accessStatus ? (
        <p
          className={clsx(
            styles.accessStatus,
            accessStatusKind === "success" && styles.accessStatusSuccess,
            accessStatusKind === "error" && styles.accessStatusError
          )}
        >
          {accessStatus}
        </p>
      ) : null}
    </article>
  );
});
