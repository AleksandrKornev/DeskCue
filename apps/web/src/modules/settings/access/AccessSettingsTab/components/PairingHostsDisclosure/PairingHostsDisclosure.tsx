import clsx from "clsx";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";

import { formatOriginsValue, formatSavedPairingHostsSummary, formatStringValue } from "@modules/settings/access/AccessSettingsTab/helpers";
import styles from "@modules/settings/access/AccessSettingsTab/styles.module.scss";
import { useSettingsPageContext } from "@modules/settings/context";
import { SettingSourceDetails } from "@modules/settings/shared/SettingSourceDetails";

import { PairingHostsDisclosureSkeleton } from "./PairingHostsDisclosureSkeleton";

function focusPairingHostAfterRemoval(removedIndex: number, previousHostCount: number) {
  const remainingHostCount = previousHostCount - 1;
  const nextInputIndex = Math.min(removedIndex, remainingHostCount - 1);
  const target = remainingHostCount > 0
    ? document.getElementById(`daemon-pairing-host-${nextInputIndex}`)
    : document.getElementById("daemon-pairing-hosts-add");

  target?.focus();
}

function cancelPairingHostRemovalFocus(frameRef: { current: number | null }) {
  if (frameRef.current === null) return;

  window.cancelAnimationFrame(frameRef.current);
  frameRef.current = null;
}

function schedulePairingHostRemovalFocus(
  frameRef: { current: number | null },
  removedIndex: number,
  previousHostCount: number
) {
  cancelPairingHostRemovalFocus(frameRef);
  frameRef.current = window.requestAnimationFrame(() => {
    frameRef.current = null;
    focusPairingHostAfterRemoval(removedIndex, previousHostCount);
  });
}

export const PairingHostsDisclosure = observer(function PairingHostsDisclosure() {
  const { accessStore } = useSettingsPageContext();
  const { daemonSettings, daemonSettingsDraft } = accessStore;
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  const removalFocusFrameRef = useRef<number | null>(null);
  const focusRequest = accessStore.pairingHostsFocusRequest;
  const isPairingHostsEditorReady = Boolean(daemonSettings && daemonSettingsDraft);

  useEffect(() => {
    if (!isPairingHostsEditorReady) return;
    if (!accessStore.shouldHandlePairingHostsFocusRequest(focusRequest)) return;

    if (disclosureRef.current) disclosureRef.current.open = true;

    const frame = window.requestAnimationFrame(() => {
      const hosts = accessStore.daemonSettingsDraft?.pairingHosts ?? [];
      const target = hosts.length > 0
        ? document.getElementById(`daemon-pairing-host-${hosts.length - 1}`)
        : document.getElementById("daemon-pairing-hosts-add");

      if (!target) return;

      target.focus();
      accessStore.acknowledgePairingHostsFocusRequest(focusRequest);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [accessStore, focusRequest, isPairingHostsEditorReady]);

  useEffect(() => () => {
    cancelPairingHostRemovalFocus(removalFocusFrameRef);
  }, []);

  if (!daemonSettings || !daemonSettingsDraft) {
    return <PairingHostsDisclosureSkeleton />;
  }

  const hasEmptyPairingHost = daemonSettingsDraft.pairingHosts.some((host) => !host.trim());

  return (
    <details className={styles.addressDisclosure} ref={disclosureRef}>
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
                    aria-label={`Pairing host ${index + 1}`}
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
                    aria-label={`Remove pairing host ${index + 1}`}
                    className={clsx(styles.inlineButton, styles.hostRowButton)}
                    onClick={() => {
                      const previousHostCount = daemonSettingsDraft.pairingHosts.length;

                      accessStore.onRemovePairingHost(index);

                      schedulePairingHostRemovalFocus(
                        removalFocusFrameRef,
                        index,
                        previousHostCount
                      );
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
