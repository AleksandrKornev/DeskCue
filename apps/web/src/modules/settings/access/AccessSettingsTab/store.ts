import { makeAutoObservable, observable, runInAction } from "mobx";

import type {
  AccessDeviceSummary,
  CurrentAccessState,
  DaemonSettingsResponse,
  SecurityStatusResponse
} from "@deskcue/protocol";
import type { SettingsTab } from "@modules/settings/types";

import { accessSettingsController } from "./controller";
import type { AccessSettingsController } from "./controller";
import {
  formatDeviceTitle,
  formatShortDeviceId
} from "./deviceLabels";
import { AccessPairingStore } from "./pairingStore";
import type { AccessPairingStoreHost } from "./pairingStore";
import type { AccessSettingsDraft } from "./types";

type AccessSettingsDependencies = {
  daemonSettings: DaemonSettingsResponse | null;
  daemonSettingsDraft: AccessSettingsDraft | null;
  daemonSettingsStatus: {
    kind: "error";
    message: string;
  } | null;
  securityStatus: SecurityStatusResponse | null;
  securityStatusMessage: string;
  onAddPairingHost: () => void;
  onAllowedOriginsTextChange: (value: string) => void;
  onAuthRequiredChange: (value: boolean) => void;
  onPairingHostChange: (index: number, value: string) => void;
  onPublicHostChange: (value: string) => void;
  onRemovePairingHost: (index: number) => void;
  onResetDaemonSettings: () => void;
  onSaveDaemonSettings: () => void;
};

type SelectSettingsTab = (nextTab: SettingsTab) => void;

const noop = () => {};

export class AccessSettingsStore implements AccessPairingStoreHost {
  accessDevices: AccessDeviceSummary[] = [];
  accessStatus = "";
  accessStatusKind: "error" | "success" = "success";
  currentAccess: CurrentAccessState | null = null;
  daemonSettings: DaemonSettingsResponse | null = null;
  daemonSettingsDraft: AccessSettingsDraft | null = null;
  daemonSettingsStatus: AccessSettingsDependencies["daemonSettingsStatus"] = null;
  forgettingCurrentBrowser = false;
  hasLoadedAccessDevices = false;
  loadingAccessDevices = false;
  pairingHostsFocusRequest = 0;
  renamingAccessDeviceId: string | null = null;
  resettingOtherTokens = false;
  revokingAccessDeviceId: string | null = null;
  securityStatus: SecurityStatusResponse | null = null;
  securityStatusMessage = "";
  selectSettingsTab: SelectSettingsTab | null = null;
  readonly pairingStore = new AccessPairingStore(this);
  private readonly controller: AccessSettingsController;
  private requestGeneration = 0;
  private onAddPairingHost: AccessSettingsDependencies["onAddPairingHost"] = noop;
  onAllowedOriginsTextChange: AccessSettingsDependencies["onAllowedOriginsTextChange"] = noop;
  onAuthRequiredChange: AccessSettingsDependencies["onAuthRequiredChange"] = noop;
  onPairingHostChange: AccessSettingsDependencies["onPairingHostChange"] = noop;
  onPublicHostChange: AccessSettingsDependencies["onPublicHostChange"] = noop;
  onRemovePairingHost: AccessSettingsDependencies["onRemovePairingHost"] = noop;
  onResetDaemonSettings: AccessSettingsDependencies["onResetDaemonSettings"] = noop;
  onSaveDaemonSettings: AccessSettingsDependencies["onSaveDaemonSettings"] = noop;

  constructor(controller: AccessSettingsController = accessSettingsController) {
    this.controller = controller;
    makeAutoObservable<this, "controller" | "requestGeneration">(
      this,
      {
        accessDevices: observable.ref,
        controller: false,
        currentAccess: observable.ref,
        daemonSettings: observable.ref,
        daemonSettingsDraft: observable.ref,
        daemonSettingsStatus: observable.ref,
        securityStatus: observable.ref,
        pairingStore: false,
        requestGeneration: false,
        selectSettingsTab: false
      },
      {
        autoBind: true
      }
    );
  }

  get creatingPairingLink() {
    return this.pairingStore.creatingPairingLink;
  }

  get creatingRecoveryCode() {
    return this.pairingStore.creatingRecoveryCode;
  }

  get devicePairingDialogViewModel() {
    return this.pairingStore.devicePairingDialogViewModel;
  }

  get recoveryCode() {
    return this.pairingStore.recoveryCode;
  }

  updateDependencies(dependencies: AccessSettingsDependencies) {
    this.daemonSettings = dependencies.daemonSettings;
    this.daemonSettingsDraft = dependencies.daemonSettingsDraft;
    this.daemonSettingsStatus = dependencies.daemonSettingsStatus;
    this.securityStatus = dependencies.securityStatus;
    this.securityStatusMessage = dependencies.securityStatusMessage;
    this.onAddPairingHost = dependencies.onAddPairingHost;
    this.onAllowedOriginsTextChange = dependencies.onAllowedOriginsTextChange;
    this.onAuthRequiredChange = dependencies.onAuthRequiredChange;
    this.onPairingHostChange = dependencies.onPairingHostChange;
    this.onPublicHostChange = dependencies.onPublicHostChange;
    this.onRemovePairingHost = dependencies.onRemovePairingHost;
    this.onResetDaemonSettings = dependencies.onResetDaemonSettings;
    this.onSaveDaemonSettings = dependencies.onSaveDaemonSettings;
  }

  setSettingsTabSelector(selector: SelectSettingsTab) {
    this.selectSettingsTab = selector;
  }

  getPairingHosts() {
    return this.daemonSettings?.pairingHosts ?? [];
  }

  selectAccessSettingsTab() {
    this.selectSettingsTab?.("access");
  }

  focusPairingHostsEditor() {
    this.pairingHostsFocusRequest += 1;
  }

  loadAccessDevices() {
    if (this.hasLoadedAccessDevices || this.loadingAccessDevices) {
      return;
    }

    void this.refreshAccessDevices(true);
  }

  async refreshAccessDevices(showLoading = false) {
    const generation = this.requestGeneration;
    if (showLoading) {
      this.loadingAccessDevices = true;
    }

    try {
      const result = await this.controller.getDevices();
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.accessDevices = result.devices;
        this.currentAccess = result.currentAccess;
        this.hasLoadedAccessDevices = true;
      });
    } catch {
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.accessDevices = [];
        this.currentAccess = null;
        this.hasLoadedAccessDevices = true;
      });
    } finally {
      if (generation === this.requestGeneration && showLoading) {
        runInAction(() => {
          this.loadingAccessDevices = false;
        });
      }
    }
  }

  clearStatus() {
    this.accessStatus = "";
    this.accessStatusKind = "success";
  }

  setSuccess(message: string) {
    this.accessStatusKind = "success";
    this.accessStatus = message;
  }

  setError(message: string) {
    this.accessStatusKind = "error";
    this.accessStatus = message;
  }

  clearPairingDialog() {
    this.pairingStore.clearPairingDialog();
  }

  createPairingLink() {
    return this.pairingStore.createPairingLink();
  }

  dispose() {
    this.resetForConnectionChange();
  }

  addPairingHost() {
    this.onAddPairingHost();
    this.pairingHostsFocusRequest += 1;
  }

  copyPairingLink() {
    return this.pairingStore.copyPairingLink();
  }

  managePairingHostsFromPairingDialog() {
    this.pairingStore.managePairingHostsFromPairingDialog();
  }

  setPairingHostChoice(value: string) {
    this.pairingStore.setPairingHostChoice(value);
  }

  setPairingLinkOrigin(value: string) {
    this.pairingStore.setPairingLinkOrigin(value);
  }

  createRecoveryCode() {
    return this.pairingStore.createRecoveryCode();
  }

  copyRecoveryCode() {
    return this.pairingStore.copyRecoveryCode();
  }

  async resetOtherAccessTokens() {
    const generation = this.requestGeneration;
    const revokesAllDeviceTokens = Boolean(
      this.currentAccess?.trustedHost && !this.currentAccess.deviceId
    );
    const confirmation = revokesAllDeviceTokens
      ? "Revoke every active access token? Host access on this computer will stay available."
      : "Revoke other active access tokens? This browser will stay paired";

    const confirmed = await this.controller.confirm({
      confirmLabel: "Revoke tokens",
      description: confirmation,
      title: revokesAllDeviceTokens ? "Revoke all access tokens?" : "Revoke other access tokens?",
      tone: "danger"
    });

    if (!confirmed || generation !== this.requestGeneration) {
      return;
    }

    this.resettingOtherTokens = true;
    this.clearStatus();

    const result = await this.controller.revokeOtherDevices();
    if (generation !== this.requestGeneration) return;
    runInAction(() => {
      this.resettingOtherTokens = false;
    });

    if (result.ok) {
      runInAction(() => {
        this.clearPairingDialog();
        const tokenLabel = result.data.revokedCount === 1 ? "access token" : "access tokens";
        this.setSuccess(
          revokesAllDeviceTokens
            ? `Revoked ${result.data.revokedCount} active ${tokenLabel}`
            : `Revoked ${result.data.revokedCount} other ${tokenLabel}`
        );
      });
      await this.refreshAccessDevices();
      return;
    }

    runInAction(() => {
      this.setError(result.data.error ?? "Failed to revoke access token");
    });
  }

  async forgetCurrentBrowser() {
    const generation = this.requestGeneration;
    const confirmed = await this.controller.confirm({
      confirmLabel: "Forget browser",
      description: "You may need a pairing link to reconnect this browser.",
      title: "Forget this browser?",
      tone: "danger"
    });

    if (!confirmed || generation !== this.requestGeneration) {
      return;
    }

    this.forgettingCurrentBrowser = true;
    const result = await this.controller.revokeCurrentDevice();
    if (generation !== this.requestGeneration) return;

    runInAction(() => {
      this.forgettingCurrentBrowser = false;
    });

    if (result.ok) {
      this.controller.forgetAccessToken();
      runInAction(() => {
        this.clearPairingDialog();
        this.setSuccess("This browser was removed");
      });
      return;
    }

    runInAction(() => {
      this.setError(result.data.error ?? "Failed to forget this browser");
    });
  }

  async revokeAccessDevice(device: AccessDeviceSummary) {
    const generation = this.requestGeneration;
    const confirmed = await this.controller.confirm({
      confirmLabel: "Revoke token",
      description: `Access token ${formatShortDeviceId(device.id)} for ${formatDeviceTitle(device)} will stop working.`,
      title: "Revoke access token?",
      tone: "danger"
    });

    if (!confirmed || generation !== this.requestGeneration) {
      return;
    }

    this.revokingAccessDeviceId = device.id;
    this.clearStatus();

    const result = await this.controller.revokeDevice(device.id);
    if (generation !== this.requestGeneration) return;
    runInAction(() => {
      this.revokingAccessDeviceId = null;
    });

    if (result.ok) {
      runInAction(() => {
        this.setSuccess(`Revoked access token ${formatShortDeviceId(device.id)}`);
      });
      await this.refreshAccessDevices();
      return;
    }

    runInAction(() => {
      this.setError(result.data.error ?? "Failed to revoke access token");
    });
  }

  async renameAccessDevice(device: AccessDeviceSummary, label: string) {
    const trimmedLabel = label.trim();
    if (!trimmedLabel || trimmedLabel === device.label) {
      return true;
    }

    const generation = this.requestGeneration;
    this.renamingAccessDeviceId = device.id;
    this.clearStatus();

    const result = await this.controller.renameDevice(device.id, trimmedLabel);
    if (generation !== this.requestGeneration) return false;
    runInAction(() => {
      this.renamingAccessDeviceId = null;
    });

    if (result.ok) {
      runInAction(() => {
        this.accessDevices = this.accessDevices.map((currentDevice) =>
          currentDevice.id === result.data.device.id ? result.data.device : currentDevice
        );
        this.setSuccess("Device name updated");
      });
      return true;
    }

    runInAction(() => {
      this.setError(result.data.error ?? "Failed to rename device");
    });
    return false;
  }

  resetForConnectionChange() {
    this.requestGeneration += 1;
    this.pairingStore.dispose();
    this.accessDevices = [];
    this.accessStatus = "";
    this.accessStatusKind = "success";
    this.currentAccess = null;
    this.daemonSettings = null;
    this.daemonSettingsDraft = null;
    this.daemonSettingsStatus = null;
    this.forgettingCurrentBrowser = false;
    this.hasLoadedAccessDevices = false;
    this.loadingAccessDevices = false;
    this.renamingAccessDeviceId = null;
    this.resettingOtherTokens = false;
    this.revokingAccessDeviceId = null;
    this.securityStatus = null;
    this.securityStatusMessage = "";
  }

}
