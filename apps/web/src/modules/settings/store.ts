import { makeAutoObservable, observable, reaction } from "mobx";
import type { IReactionDisposer } from "mobx";

import { AccessSettingsStore } from "./access/AccessSettingsTab/store";
import { DaemonSettingsStore } from "./daemonSettings";
import { NotificationSettingsStore } from "./notifications/NotificationSettingsTab/store";
import { SettingsMutationCoordinator } from "./settingsMutationCoordinator";
import { StorageSettingsStore } from "./storage/StorageSettingsTab/store";
import { SystemSettingsStore } from "./system/SystemSettingsTab/store";
import type { SettingsTab, WriteTabSearchParam } from "./types";

export class SettingsPageStore {
  accessStore = new AccessSettingsStore();
  activeTab: SettingsTab;
  settingsMutationCoordinator = new SettingsMutationCoordinator();
  daemonSettingsStore = new DaemonSettingsStore(undefined, this.settingsMutationCoordinator);
  daemonSettingsDisposer: IReactionDisposer | null = null;
  notificationStore = new NotificationSettingsStore();
  storageStore = new StorageSettingsStore(undefined, this.settingsMutationCoordinator);
  systemStore = new SystemSettingsStore();
  writeTabSearchParam: WriteTabSearchParam | null = null;

  constructor(initialTab: SettingsTab) {
    this.activeTab = initialTab;

    makeAutoObservable(
      this,
      {
        accessStore: observable.ref,
        daemonSettingsDisposer: false,
        daemonSettingsStore: observable.ref,
        notificationStore: observable.ref,
        storageStore: observable.ref,
        systemStore: observable.ref,
        writeTabSearchParam: false
      },
      {
        autoBind: true
      }
    );

    this.startDaemonSettingsReaction();
    this.accessStore.setSettingsTabSelector(this.handleSelectSettingsTab);
  }

  startDaemonSettingsReaction() {
    if (this.daemonSettingsDisposer) {
      return;
    }

    this.daemonSettingsDisposer = reaction(
      () => ({
        daemonSettings: this.daemonSettingsStore.daemonSettings,
        daemonSettingsDraft: this.daemonSettingsStore.daemonSettingsDraft,
        daemonSettingsStatus: this.daemonSettingsStore.daemonSettingsStatus,
        resettingDaemonSettings: this.daemonSettingsStore.resettingDaemonSettings,
        savingDaemonSettings: this.daemonSettingsStore.savingDaemonSettings,
        securityStatus: this.daemonSettingsStore.securityStatus,
        securityStatusMessage: this.daemonSettingsStore.securityStatusMessage,
        settingsConnectionRevision: this.daemonSettingsStore.settingsConnectionRevision,
        settingsMutationPending: this.daemonSettingsStore.settingsMutationPending,
        settingsSaveSuccessRevision: this.daemonSettingsStore.settingsSaveSuccessRevision
      }),
      ({
        daemonSettings,
        daemonSettingsDraft,
        daemonSettingsStatus,
        resettingDaemonSettings,
        savingDaemonSettings,
        securityStatus,
        securityStatusMessage,
        settingsConnectionRevision,
        settingsMutationPending,
        settingsSaveSuccessRevision
      }) => {
        this.accessStore.updateDependencies({
          daemonSettings,
          daemonSettingsDraft,
          daemonSettingsStatus,
          resettingDaemonSettings,
          savingDaemonSettings,
          securityStatus,
          securityStatusMessage,
          settingsMutationPending,
          onAddPairingHost: this.daemonSettingsStore.onAddPairingHost,
          onAllowedOriginsTextChange: this.daemonSettingsStore.onAllowedOriginsTextChange,
          onAuthRequiredChange: this.daemonSettingsStore.onAuthRequiredChange,
          onPairingHostChange: this.daemonSettingsStore.onPairingHostChange,
          onPublicHostChange: this.daemonSettingsStore.onPublicHostChange,
          onRemovePairingHost: this.daemonSettingsStore.onRemovePairingHost,
          onResetDaemonSettings: this.daemonSettingsStore.onResetDaemonSettings,
          onSaveDaemonSettings: this.daemonSettingsStore.onSaveDaemonSettings
        });
        this.storageStore.updateDependencies({
          daemonSettings,
          syncDaemonSettings: this.daemonSettingsStore.syncDaemonSettingsPreservingDraft
        });
        this.systemStore.updateDependencies({
          daemonSettings,
          daemonSettingsDraft,
          daemonSettingsStatus,
          resettingDaemonSettings,
          savingDaemonSettings,
          securityStatus,
          securityStatusMessage,
          settingsConnectionRevision,
          settingsMutationPending,
          settingsSaveSuccessRevision,
          onAgentDataRootChange: this.daemonSettingsStore.onAgentDataRootChange,
          onResetDaemonSettings: this.daemonSettingsStore.onResetDaemonSettings,
          onRuntimeEndpointChange: this.daemonSettingsStore.onRuntimeEndpointChange,
          onSaveDaemonSettings: this.daemonSettingsStore.onSaveDaemonSettings
        });
      },
      { fireImmediately: true }
    );
  }

  setTabSearchParamWriter(writer: WriteTabSearchParam) {
    this.writeTabSearchParam = writer;
  }

  syncActiveTabFromRoute(nextTab: SettingsTab) {
    this.activeTab = nextTab;
  }

  handleSelectSettingsTab(nextTab: SettingsTab) {
    this.activeTab = nextTab;
    this.writeTabSearchParam?.(nextTab);
  }

  load() {
    this.startDaemonSettingsReaction();
    this.daemonSettingsStore.loadDaemonSettings();
  }

  dispose() {
    this.accessStore.dispose();
    this.daemonSettingsStore.resetForConnectionChange();
    this.notificationStore.resetForConnectionChange();
    this.storageStore.resetForConnectionChange();
    this.systemStore.resetForConnectionChange();
    this.daemonSettingsDisposer?.();
    this.daemonSettingsDisposer = null;
  }

  resetForConnectionChange() {
    this.accessStore.resetForConnectionChange();
    this.daemonSettingsStore.resetForConnectionChange();
    this.notificationStore.resetForConnectionChange();
    this.storageStore.resetForConnectionChange();
    this.systemStore.resetForConnectionChange();
    this.daemonSettingsStore.loadDaemonSettings();
  }
}
