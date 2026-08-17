import clsx from "clsx";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";

import { formatOriginsValue, formatSavedPairingHostsSummary, formatStringValue } from "@modules/settings/access/AccessSettingsTab/helpers";
import styles from "@modules/settings/access/AccessSettingsTab/styles.module.scss";
import { useSettingsPageContext } from "@modules/settings/context";
import { SettingSourceDetails } from "@modules/settings/shared/SettingSourceDetails";

import { PairingHostsDisclosureSkeleton } from "./PairingHostsDisclosureSkeleton";

export const PairingHostsDisclosure = observer(function PairingHostsDisclosure() {
  const { accessStore } = useSettingsPageContext();
  const { daemonSettings, daemonSettingsDraft } = accessStore;

  useEffect(() => {
    if (accessStore.pairingHostsFocusRequest === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const hosts = accessStore.daemonSettingsDraft?.pairingHosts ?? [];
      const target = hosts.length > 0
        ? document.getElementById(`daemon-pairing-host-${hosts.length - 1}`)
        : document.getElementById("daemon-pairing-hosts-add");
      target?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [accessStore, accessStore.pairingHostsFocusRequest]);

  if (!daemonSettings || !daemonSettingsDraft) {
    return <PairingHostsDisclosureSkeleton />;
  }

  const hasEmptyPairingHost = daemonSettingsDraft.pairingHosts.some((host) => !host.trim());

  return (
    <details className={styles.addressDisclosure}>
      <summary>
        <span className={styles.addressDisclosureSummary}>
          <span className={styles.addressDisclosureEyebrow}>
            Connection addresses
          </span>
          <strong>Manage saved pairing hosts</strong>
          <small>
            Reusable LAN, VPN, domain, or proxy addresses for device
            pairing links. {formatSavedPairingHostsSummary(daemonSettings.pairingHosts)}
          </small>
        </span>
        <span className={styles.addressDisclosureAction}>
          <span>Open settings</span>
          <span className={styles.addressDisclosureChevron} aria-hidden="true" />
        </span>
      </summary>
      <form
        className={styles.settingsForm}
        onSubmit={(event) => {
          event.preventDefault();
          accessStore.onSaveDaemonSettings();
        }}
      >
        <div className={styles.formHeader}>
          <div>
            <h3>Connection addresses</h3>
            <p>Reusable addresses for device pairing links</p>
          </div>
          <span className={styles.filePath}>{daemonSettings.settingsFilePath}</span>
        </div>

        <label className={styles.fieldLabel}>
          <span>Public host</span>
          <input
            className={styles.field}
            id="daemon-public-host"
            name="publicHost"
            placeholder="https://deskcue.example.com or <your-lan-ip>"
            value={daemonSettingsDraft.publicHost}
            onChange={(event) => {
              accessStore.onPublicHostChange(event.target.value);
            }}
          />
          <small>
            Fallback address for generated pairing links and allowed origin derivation
          </small>
        </label>
        <SettingSourceDetails<string | null>
          source={daemonSettings.sources.publicHost}
          valueFormatter={formatStringValue}
        />

        <div className={styles.fieldLabel}>
          <span>Pairing hosts</span>
          <div className={styles.hostList}>
            {daemonSettingsDraft.pairingHosts.length ? (
              daemonSettingsDraft.pairingHosts.map((host, index) => (
                <div className={styles.hostRow} key={index}>
                  <input
                    className={styles.field}
                    id={`daemon-pairing-host-${index}`}
                    name={`pairingHost-${index}`}
                    placeholder="https://deskcue.example.com or http://<your-lan-ip>:4100"
                    value={host}
                    onChange={(event) => {
                      accessStore.onPairingHostChange(index, event.target.value);
                    }}
                  />
                  <button
                    className={clsx(styles.inlineButton, styles.hostRowButton)}
                    onClick={() => {
                      accessStore.onRemovePairingHost(index);
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <div className={styles.emptyHostList}>
                No saved hosts yet
              </div>
            )}
            <button
              className={clsx(styles.inlineButton, styles.hostAddButton)}
              disabled={hasEmptyPairingHost}
              id="daemon-pairing-hosts-add"
              onClick={accessStore.addPairingHost}
              type="button"
            >
              Add host
            </button>
          </div>
          <small>
            Add LAN IPs, domains, VPN names, or proxy URLs. Custom one-off remains available in the link modal.
            {hasEmptyPairingHost ? " Fill or remove the empty host before saving." : ""}
          </small>
        </div>
        <SettingSourceDetails
          source={daemonSettings.sources.pairingHosts}
          valueFormatter={formatOriginsValue}
        />
      </form>
    </details>
  );
});
