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
  securityStatus: SecurityStatusResponse | null;
  securityStatusMessage: string;
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

export class SystemSettingsStore {
  daemonSettings: DaemonSettingsResponse | null = null;
  daemonSettingsDraft: SystemSettingsDraft | null = null;
  daemonSettingsStatus: SystemSettingsDependencies["daemonSettingsStatus"] = null;
  securityStatus: SecurityStatusResponse | null = null;
  securityStatusMessage = "";
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

  updateDependencies(dependencies: SystemSettingsDependencies) {
    this.daemonSettings = dependencies.daemonSettings;
    this.daemonSettingsDraft = dependencies.daemonSettingsDraft;
    this.daemonSettingsStatus = dependencies.daemonSettingsStatus;
    this.securityStatus = dependencies.securityStatus;
    this.securityStatusMessage = dependencies.securityStatusMessage;
    this.onAgentDataRootChange = dependencies.onAgentDataRootChange;
    this.onResetDaemonSettings = dependencies.onResetDaemonSettings;
    this.onRuntimeEndpointChange = dependencies.onRuntimeEndpointChange;
    this.onSaveDaemonSettings = dependencies.onSaveDaemonSettings;
  }

  resetForConnectionChange() {
    this.daemonSettings = null;
    this.daemonSettingsDraft = null;
    this.daemonSettingsStatus = null;
    this.securityStatus = null;
    this.securityStatusMessage = "";
  }
}
