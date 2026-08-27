import clsx from "clsx";

import { Modal } from "@components/Modal";

import { PairingQrCode } from "./components/PairingQrCode";
import {
  formatPairingHostSourceDescription,
  formatPairingHostSourceLabel,
  formatPairingReadiness,
  isLoopbackPairingLink
} from "./helpers";
import styles from "./styles.module.scss";
import type { DevicePairingDialogProps } from "./types";

export function DevicePairingDialog({
  activePairingOrigin,
  activePairingWebUrl,
  isCustomPairingOrigin,
  isSavedPairingOrigin,
  pairingHostChoice,
  pairingHostOptions,
  pairingLink,
  pairingLinkOrigin,
  onClose,
  onCopyPairingLink,
  onManagePairingHosts,
  onPairingHostChoiceChange,
  onPairingLinkOriginChange
}: DevicePairingDialogProps) {
  return (
    <Modal
      closeLabel="Close device link dialog"
      description={formatPairingReadiness(pairingLink)}
      eyebrow="Device link"
      isOpen
      title="Pair another device"
      onClose={onClose}
    >
      <div className={styles.pairingSummary}>
        <div>
          <a
            className={styles.pairingSummaryLink}
            href={activePairingWebUrl}
            rel="noreferrer"
            target="_blank"
          >
            {activePairingWebUrl}
          </a>
          <small>Open this link on another device or copy it to another browser</small>
        </div>
        <button
          className={styles.button}
          onClick={onCopyPairingLink}
          type="button"
        >
          Copy device link
        </button>
      </div>
      <label className={styles.pairingOriginField}>
        <span>Connection address</span>
        <select
          id="pairing-connection-address"
          name="pairingConnectionAddress"
          value={pairingHostChoice}
          onChange={(event) => {
            const nextValue = event.target.value;
            onPairingHostChoiceChange(nextValue);

            if (nextValue !== "custom") {
              onPairingLinkOriginChange(nextValue);
            }
          }}
        >
          {pairingHostOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          <option value="custom">Custom one-off address</option>
        </select>
        <input
          disabled={pairingHostChoice !== "custom"}
          id="pairing-custom-address"
          name="pairingCustomAddress"
          value={pairingLinkOrigin}
          onChange={(event) => {
            onPairingHostChoiceChange("custom");
            onPairingLinkOriginChange(event.target.value);
          }}
          placeholder="https://deskcue.example.com or http://<your-lan-ip>:4100"
        />
        <small>
          Select saved addresses from Connections, or use custom for a one-time LAN IP,
          domain, VPN name, or proxy URL.
        </small>
      </label>
      <PairingQrCode value={activePairingWebUrl} />
      <div
        className={clsx(
          styles.pairingRoutePanel,
          pairingLink.lanReady === false && styles.pairingRoutePanelWarning
        )}
      >
        <div className={styles.pairingRouteHeader}>
          <span className={styles.label}>Connection route</span>
          <strong>
            {formatPairingHostSourceLabel(
              pairingLink.hostSource,
              isCustomPairingOrigin,
              isSavedPairingOrigin
            )}
          </strong>
        </div>
        <p>
          {formatPairingHostSourceDescription(
            pairingLink,
            isCustomPairingOrigin,
            isSavedPairingOrigin
          )}
        </p>
        <dl className={styles.pairingRouteGrid}>
          <div>
            <dt>Selected web address</dt>
            <dd>
              <a href={activePairingWebUrl} rel="noreferrer" target="_blank">
                {activePairingWebUrl}
              </a>
            </dd>
          </div>
          <div>
            <dt>Pairing endpoint</dt>
            <dd>{activePairingOrigin ? `${activePairingOrigin}/api/access/pair` : "Invalid address"}</dd>
          </div>
        </dl>
        <div className={styles.pairingRouteActions}>
          <button
            className={styles.inlineButton}
            onClick={onManagePairingHosts}
            type="button"
          >
            Manage saved hosts
          </button>
          <span>Save reusable hosts in settings; custom one-off remains available here.</span>
        </div>
      </div>
      <details className={styles.pairingDetails}>
        <summary>Show code and full URL</summary>
        <div className={styles.pairingDetailsContent}>
          <span className={styles.label}>Pairing code</span>
          <strong className={styles.pairingCode}>{pairingLink.pairCode}</strong>
          <a
            className={styles.pairingLink}
            href={activePairingWebUrl}
            rel="noreferrer"
            target="_blank"
          >
            {activePairingWebUrl}
          </a>
        </div>
      </details>
      {pairingLink.warnings?.length ? (
        <div className={styles.pairingWarning}>
          {pairingLink.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      {!pairingLink.warnings?.length && isLoopbackPairingLink(pairingLink.webUrl) ? (
        <p className={styles.pairingWarning}>
          This link uses localhost; add a reachable address under Connections → Manage
          device access and create a new link
        </p>
      ) : null}
    </Modal>
  );
}
