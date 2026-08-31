import { makeAutoObservable, observable } from "mobx";

import type { DaemonSettingsResponse, SecurityStatusResponse } from "@deskcue/protocol";

import type { SystemSettingsDraft } from "./types";

type SystemSettingsDependencies = {
  daemonSettings: DaemonSettingsResponse | null;
  daemonSettingsDraft: SystemSettingsDraft | null;
  daemonSettingsStatus: {
    kind: "error";
    message: string;
  } | null;
  resettingDaemonSettings: boolean;
  savingDaemonSettings: boolean;
  securityStatus: SecurityStatusResponse | null;
  securityStatusMessage: string;
  settingsConnectionRevision: number;
  settingsMutationPending: boolean;
  settingsSaveSuccessRevision: number;
  onAgentDataRootChange: (
    fieldName: keyof DaemonSettingsResponse["agentDataRoots"],
    value: string
  ) => void;
  onResetDaemonSettings: () => void;
  onRuntimeEndpointChange: (
    fieldName: keyof DaemonSettingsResponse["runtimeEndpoints"],
    value: string
  ) => void;
  onSaveDaemonSettings: () => void;
};

const noop = () => {};

function serializeSystemSettings(value: SystemSettingsDraft) {
  return JSON.stringify({
    agentDataRoots: value.agentDataRoots,
    runtimeEndpoints: value.runtimeEndpoints
  });
}

export class SystemSettingsStore {
  daemonSettings: DaemonSettingsResponse | null = null;
  daemonSettingsDraft: SystemSettingsDraft | null = null;
  daemonSettingsStatus: SystemSettingsDependencies["daemonSettingsStatus"] = null;
  resettingDaemonSettings = false;
  savingDaemonSettings = false;
  securityStatus: SecurityStatusResponse | null = null;
  securityStatusMessage = "";
  settingsConnectionRevision = 0;
  settingsMutationPending = false;
  settingsSaveSuccessRevision = 0;
  onAgentDataRootChange: SystemSettingsDependencies["onAgentDataRootChange"] = noop;
  onResetDaemonSettings: SystemSettingsDependencies["onResetDaemonSettings"] = noop;
  onRuntimeEndpointChange: SystemSettingsDependencies["onRuntimeEndpointChange"] = noop;
  onSaveDaemonSettings: SystemSettingsDependencies["onSaveDaemonSettings"] = noop;

  constructor() {
    makeAutoObservable(
      this,
      {
        daemonSettings: observable.ref,
        daemonSettingsDraft: observable.ref,
        daemonSettingsStatus: observable.ref,
        securityStatus: observable.ref,
        onAgentDataRootChange: false,
        onResetDaemonSettings: false,
        onRuntimeEndpointChange: false,
        onSaveDaemonSettings: false
      },
      {
        autoBind: true
      }
    );
  }

  get systemSettingsDirty() {
    if (!this.daemonSettings || !this.daemonSettingsDraft) return false;

    return serializeSystemSettings(this.daemonSettingsDraft) !== serializeSystemSettings({
      agentDataRoots: this.daemonSettings.agentDataRoots,
      runtimeEndpoints: this.daemonSettings.runtimeEndpoints
    });
  }

  get systemSettingsOperationPending() {
    return this.settingsMutationPending;
  }

  updateDependencies(dependencies: SystemSettingsDependencies) {
    this.daemonSettings = dependencies.daemonSettings;
    this.daemonSettingsDraft = dependencies.daemonSettingsDraft;
    this.daemonSettingsStatus = dependencies.daemonSettingsStatus;
    this.resettingDaemonSettings = dependencies.resettingDaemonSettings;
    this.savingDaemonSettings = dependencies.savingDaemonSettings;
    this.securityStatus = dependencies.securityStatus;
    this.securityStatusMessage = dependencies.securityStatusMessage;
    this.settingsConnectionRevision = dependencies.settingsConnectionRevision;
    this.settingsMutationPending = dependencies.settingsMutationPending;
    this.settingsSaveSuccessRevision = dependencies.settingsSaveSuccessRevision;
    this.onAgentDataRootChange = dependencies.onAgentDataRootChange;
    this.onResetDaemonSettings = dependencies.onResetDaemonSettings;
    this.onRuntimeEndpointChange = dependencies.onRuntimeEndpointChange;
    this.onSaveDaemonSettings = dependencies.onSaveDaemonSettings;
  }

  resetForConnectionChange() {
    this.daemonSettings = null;
    this.daemonSettingsDraft = null;
    this.daemonSettingsStatus = null;
    this.resettingDaemonSettings = false;
    this.savingDaemonSettings = false;
    this.securityStatus = null;
    this.securityStatusMessage = "";
    this.settingsMutationPending = false;
  }
}
