import clsx from "clsx";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { ConfirmDialog } from "@components/ModalDialog";
import { useSettingsPageContext } from "@modules/settings/context";
import { SettingSourceDetails } from "@modules/settings/shared/SettingSourceDetails";

import {
  formatBytes,
  formatMegabytesValue,
  storageLimitPresets
} from "./helpers";
import styles from "./styles.module.scss";

export const StorageSettingsTab = observer(function StorageSettingsTab() {
  const { storageStore } = useSettingsPageContext();
  const [confirmationTarget, setConfirmationTarget] = useState<"service" | "backups" | null>(null);
  const {
    clearingMigrationBackups,
    compactingStorage,
    daemonSettings,
    loadingStorageStats,
    savingStorageBudget,
    storageStats
  } = storageStore;
  const serviceUsagePercent = storageStats
    ? Math.min(
        100,
        (storageStats.database.serviceUsageBytes / storageStats.database.storageLimitBytes) * 100
      )
    : 0;
  const serviceUsageLabel = serviceUsagePercent >= 100
    ? "Over limit"
    : serviceUsagePercent >= 90
      ? "Near limit"
      : "Healthy";

  useEffect(() => {
    storageStore.loadStorageStats();
  }, [storageStore]);

  const isConfirming =
    confirmationTarget === "service"
      ? compactingStorage
      : confirmationTarget === "backups"
        ? clearingMigrationBackups
        : false;
  const confirmTitle = confirmationTarget === "service"
    ? "Clear service storage?"
    : "Delete recovery copies?";
  const confirmDescription = confirmationTarget === "service"
    ? "This permanently removes all non-running session cards and DeskCue logs. Running sessions, pairing and access, workspaces, settings, recovery copies, and Ollama or LM Studio chats stay unchanged."
    : `This permanently removes ${storageStats?.migrationBackups.count ?? 0} migration recovery copies (${formatBytes(storageStats?.migrationBackups.bytes ?? 0)}). Service data and all chats stay unchanged.`;
  const handleConfirm = async () => {
    if (confirmationTarget === "service") {
      await storageStore.compactStorage();
    } else if (confirmationTarget === "backups") {
      await storageStore.clearMigrationBackups();
    }

    setConfirmationTarget(null);
  };

  return (
    <>
      <article className={styles.card} role="tabpanel">
      <div className={styles.cardHeader}>
        <div>
          <span className={styles.label}>Storage</span>
          <h2>DeskCue storage</h2>
          <p>Service state and DeskCue-owned local model chats stay on this computer.</p>
        </div>
      </div>
      <div className={styles.storagePanel}>
        {loadingStorageStats && !storageStats ? (
          <p className={styles.status}>Loading storage stats...</p>
        ) : storageStats ? (
          <>
            <section className={styles.serviceSummary} aria-label="Service storage summary">
              <div className={styles.serviceHeader}>
                <div>
                  <span className={styles.label}>Service storage</span>
                  <strong>Daemon state, cache, and logs</strong>
                  <small>SQLite state, WAL files, logs, and session cache.</small>
                </div>
              </div>
              <div className={styles.usageRow}>
                <div>
                  <span className={styles.label}>Service budget usage</span>
                  <strong>
                    {formatBytes(storageStats.database.serviceUsageBytes)} / {formatBytes(storageStats.database.storageLimitBytes)}
                  </strong>
                </div>
                <span
                  className={clsx(
                    styles.usageStatus,
                    serviceUsagePercent >= 90 && styles.usageStatusWarning
                  )}
                >
                  {serviceUsageLabel} · {Math.round(serviceUsagePercent)}%
                </span>
              </div>
              <div
                aria-label={`Service storage budget is ${Math.round(serviceUsagePercent)} percent full`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(serviceUsagePercent)}
                className={styles.usageMeter}
                role="progressbar"
              >
                <span
                  className={serviceUsagePercent >= 90 ? styles.usageMeterWarning : undefined}
                  style={{ width: `${serviceUsagePercent}%` }}
                />
              </div>
              {storageStats.warnings.length > 0 ? (
                <div className={styles.warningBox}>
                  {storageStats.warnings.map((warning) => (
                    <p key={warning.code}>{warning.message}</p>
                  ))}
                </div>
              ) : null}
            </section>

            <section className={styles.quickCleanup} aria-label="Manual service cleanup">
              <div>
                <span className={styles.label}>Manual cleanup</span>
                <strong>Clear service history and logs</strong>
                <small>Running sessions, recovery copies, and local model chats stay unchanged.</small>
              </div>
              <button
                className={styles.clearButton}
                disabled={compactingStorage || loadingStorageStats}
                onClick={() => setConfirmationTarget("service")}
                type="button"
              >
                {compactingStorage ? "Clearing..." : "Clear service storage"}
              </button>
            </section>

            {daemonSettings ? (
              <section className={styles.cacheBudgetPanel}>
                <div>
                  <span className={styles.label}>Service limit</span>
                  <strong>Choose the service storage budget</strong>
                  <small>DeskCue automatically retains up to 1,000 non-running session cards for 7 days and rotates logs.</small>
                </div>
                <div className={styles.cacheBudgetOptions}>
                  {storageLimitPresets.map((budget) => (
                    <button
                      className={clsx(
                        styles.inlineButton,
                        daemonSettings.storageMaxMb === budget && styles.cacheBudgetSelected
                      )}
                      disabled={savingStorageBudget || daemonSettings.sources.storageMaxMb.source === "env"}
                      key={budget}
                      onClick={() => { storageStore.setStorageBudgetFromPreset(budget); }}
                      type="button"
                    >
                      {budget} MiB
                    </button>
                  ))}
                  <button
                    className={clsx(
                      styles.inlineButton,
                      !storageLimitPresets.includes(daemonSettings.storageMaxMb) && styles.cacheBudgetSelected
                    )}
                    disabled={savingStorageBudget || daemonSettings.sources.storageMaxMb.source === "env"}
                    onClick={storageStore.openCustomStorageLimitDialog}
                    type="button"
                  >
                    Custom
                  </button>
                </div>
              </section>
            ) : null}

            <section className={styles.retentionPanel} aria-label="Automatic service cleanup">
              <div>
                <span className={styles.label}>Automatic cleanup</span>
                <strong>Session history stays bounded</strong>
                <small>
                  Keeps up to 1,000 non-running session cards for 7 days. Running sessions stay available.
                </small>
              </div>
              <p>
                Includes old session cache and normal log rotation. Local model chats and recovery copies are separate.
              </p>
            </section>

            <section className={styles.localChatsPanel} aria-label="Local model chat library">
              <div>
                <span className={styles.label}>Local model chats</span>
                <strong>Ollama and LM Studio chat library</strong>
                <small>Separate from the service limit and service cleanup.</small>
              </div>
              <dl className={styles.localChatsGrid}>
                <div>
                  <dt>Saved chats</dt>
                  <dd>{storageStats.localChats.chatCount}</dd>
                </div>
                <div>
                  <dt>Library size</dt>
                  <dd>{formatBytes(storageStats.localChats.bytes)}</dd>
                </div>
              </dl>
            </section>

            {storageStats.migrationBackups.count > 0 ? (
              <section className={styles.migrationBackups} aria-label="Migration recovery copies">
                <div>
                  <span className={styles.label}>Recovery copies</span>
                  <strong>
                    {storageStats.migrationBackups.count} backup{storageStats.migrationBackups.count === 1 ? "" : "s"} · {formatBytes(storageStats.migrationBackups.bytes)}
                  </strong>
                  <small>They use disk, but are never included in the service budget or normal cleanup.</small>
                </div>
                <button
                  className={styles.inlineButton}
                  disabled={clearingMigrationBackups || loadingStorageStats}
                  onClick={() => setConfirmationTarget("backups")}
                  type="button"
                >
                  {clearingMigrationBackups ? "Deleting..." : "Delete copies"}
                </button>
              </section>
            ) : null}

            <details className={styles.detailsDisclosure}>
              <summary>
                <span>Maintenance & paths</span>
                <small>Clear history, logs, and inspect files</small>
              </summary>
              <div className={styles.detailsDisclosureBody}>
                <Link className={styles.logsLink} to="/logs">
                  Open system logs
                </Link>
                <dl className={styles.storageGrid}>
                  <div>
                    <dt>SQLite</dt>
                    <dd>{formatBytes(storageStats.database.bytes)}</dd>
                  </div>
                  <div>
                    <dt>WAL</dt>
                    <dd>{formatBytes(storageStats.database.walBytes)}</dd>
                  </div>
                  <div>
                    <dt>Logs</dt>
                    <dd>{formatBytes(storageStats.database.logBytes)}</dd>
                  </div>
                  <div>
                    <dt>Sessions</dt>
                    <dd>{storageStats.sessions.total}</dd>
                  </div>
                  <div>
                    <dt>Local detail cache</dt>
                    <dd>
                      {formatBytes(
                        storageStats.sessions.inactiveAttachedJsonBytes +
                          storageStats.sessions.inactiveManagedJsonBytes
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Migration backups</dt>
                    <dd>{formatBytes(storageStats.migrationBackups.bytes)}</dd>
                  </div>
                </dl>
                {daemonSettings ? (
                  <SettingSourceDetails
                    source={daemonSettings.sources.storageMaxMb}
                    valueFormatter={formatMegabytesValue}
                  />
                ) : null}
                <dl className={styles.locationList}>
                  <div>
                    <dt>Service data</dt>
                    <dd className={styles.filePath}>{storageStats.database.path}</dd>
                  </div>
                  <div>
                    <dt>Local model chats</dt>
                    <dd className={styles.filePath}>{storageStats.localChats.path}</dd>
                  </div>
                </dl>
              </div>
            </details>
          </>
        ) : (
          <p className={styles.status}>Storage stats are unavailable.</p>
        )}
      </div>
      <div className={styles.actions}>
        <button
          className={clsx(styles.button, styles.ghostButton)}
          disabled={loadingStorageStats}
          onClick={storageStore.refreshStorageStats}
          type="button"
        >
          Refresh storage
        </button>
      </div>
      </article>
      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel={confirmationTarget === "service" ? "Clear service storage" : "Delete copies"}
        confirmingLabel={confirmationTarget === "service" ? "Clearing..." : "Deleting..."}
        description={confirmDescription}
        isConfirming={isConfirming}
        isOpen={confirmationTarget !== null}
        title={confirmTitle}
        tone="danger"
        onCancel={() => setConfirmationTarget(null)}
        onConfirm={handleConfirm}
      />
    </>
  );
});
