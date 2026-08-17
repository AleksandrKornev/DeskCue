import clsx from "clsx";
import { observer } from "mobx-react-lite";
import { Link } from "react-router";

import {
  readCurrentDaemonWebOrigin,
  readDaemonUrlPort
} from "@api/connection";
import HomeIcon from "@assets/images/icon-home.svg?react";
import { DeskCueWordmark } from "@components/DeskCueWordmark";
import { SegmentedTabs } from "@components/SegmentedTabs";

import { AccessSettingsTab } from "./access/AccessSettingsTab";
import { DevicePairingDialog } from "./access/components/DevicePairingDialog";
import { SettingsPageProvider, useSettingsPageContext } from "./context";
import { settingsTabs } from "./helpers";
import { NotificationSettingsTab } from "./notifications/NotificationSettingsTab";
import { CustomStorageLimitDialog } from "./storage/components/CustomStorageLimitDialog";
import { StorageSettingsTab } from "./storage/StorageSettingsTab";
import styles from "./styles.module.scss";
import { SystemSettingsTab } from "./system/SystemSettingsTab";
import { useSettingsPageStore } from "./useSettingsPageStore";

const SettingsPageContent = observer(function SettingsPageContent() {
  const {
    activeTab,
    handleSelectSettingsTab,
    accessStore,
    storageStore
  } = useSettingsPageContext();
  const daemonWebOrigin = readCurrentDaemonWebOrigin();
  const daemonPort = readDaemonUrlPort(daemonWebOrigin);
  const hasSettingsActionBar =
    activeTab === "access" || activeTab === "notifications" || activeTab === "system";

  return (
    <main className={clsx(styles.page, hasSettingsActionBar && styles.pageWithActionBar)}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <Link className={styles.logoLink} to="/" aria-label="Back to DeskCue dashboard">
            <DeskCueWordmark className={styles.logoWordmark} />
          </Link>
          <h1>Settings</h1>
          <p>Connections, local data, notifications, and system controls for this browser</p>
          <div className={styles.headerMeta} aria-label="Local service details">
            <span title={`Local service endpoint: ${daemonWebOrigin}`}>
              {daemonPort ? `Port ${daemonPort}` : daemonWebOrigin}
            </span>
          </div>
        </div>
        <Link
          aria-label="Go to DeskCue dashboard"
          className={clsx(styles.headerAction, styles.iconButton)}
          title="Go to dashboard"
          to="/"
        >
          <HomeIcon className={styles.homeIcon} aria-hidden="true" focusable="false" />
        </Link>
      </header>

      <section className={styles.tabShell}>
        <SegmentedTabs
          activeTab={activeTab}
          ariaLabel="Settings sections"
          className={styles.settingsTabs}
          mobileLayout="fill"
          options={settingsTabs}
          onSelectTab={handleSelectSettingsTab}
        />

        {activeTab === "access" ? (
          <AccessSettingsTab />
        ) : null}

        {activeTab === "storage" ? (
          <StorageSettingsTab />
        ) : null}

        {activeTab === "system" ? (
          <SystemSettingsTab />
        ) : null}

        {activeTab === "notifications" ? (
          <NotificationSettingsTab />
        ) : null}
      </section>

      <CustomStorageLimitDialog
        customStorageMaxMb={storageStore.customStorageMaxMb}
        disabled={
          storageStore.savingStorageBudget ||
          storageStore.daemonSettings?.sources.storageMaxMb.source === "env"
        }
        isOpen={storageStore.isCustomStorageLimitDialogOpen}
        savingStorageBudget={storageStore.savingStorageBudget}
        onClose={storageStore.closeCustomStorageLimitDialog}
        onCustomStorageMaxMbChange={storageStore.setCustomStorageMaxMb}
        onSubmit={(event) => {
          event.preventDefault();
          void storageStore.submitCustomStorageLimit();
        }}
      />

      {accessStore.devicePairingDialogViewModel ? (
        <DevicePairingDialog
          {...accessStore.devicePairingDialogViewModel}
          onClose={accessStore.clearPairingDialog}
          onCopyPairingLink={accessStore.copyPairingLink}
          onManagePairingHosts={accessStore.managePairingHostsFromPairingDialog}
          onPairingHostChoiceChange={accessStore.setPairingHostChoice}
          onPairingLinkOriginChange={accessStore.setPairingLinkOrigin}
        />
      ) : null}
    </main>
  );
});

export function SettingsPage() {
  const store = useSettingsPageStore();

  return (
    <SettingsPageProvider value={store}>
      <SettingsPageContent />
    </SettingsPageProvider>
  );
}
