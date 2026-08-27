import clsx from "clsx";
import { observer } from "mobx-react-lite";

import { buildCurrentDaemonAccessSettingsUrl } from "@api/connection";
import { PairingHostsDisclosure } from "@modules/settings/access/AccessSettingsTab/components/PairingHostsDisclosure";
import styles from "@modules/settings/access/AccessSettingsTab/styles.module.scss";
import { AccessDeviceList } from "@modules/settings/access/components/AccessDeviceList";
import { useSettingsPageContext } from "@modules/settings/context";

export const DeviceAccessPanel = observer(function DeviceAccessPanel() {
  const { accessStore } = useSettingsPageContext();
  const accessSettingsUrl = buildCurrentDaemonAccessSettingsUrl();
  const {
    accessDevices,
    accessStatus,
    accessStatusKind,
    accessStatusScope,
    currentAccess,
    forgettingCurrentBrowser,
    loadingAccessDevices,
    renamingAccessDeviceId,
    resettingOtherTokens,
    revokingAccessDeviceId
  } = accessStore;

  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <span className={styles.label}>Access</span>
          <h2>Manage device access</h2>
          <p>Review pairing addresses and revoke or rename access tokens for this machine</p>
        </div>
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
        <small>
          Create a device link from any paired browser. If every device is locked out,
          open the host page below.
        </small>
        <code>{accessSettingsUrl}</code>
      </div>
      {accessStatus && accessStatusScope === "devices" ? (
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
