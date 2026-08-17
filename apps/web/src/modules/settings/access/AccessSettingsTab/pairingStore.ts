import { makeAutoObservable, observable, runInAction } from "mobx";

import type {
  AccessLinkResponse,
  CreateAccessRecoveryCodeResponse
} from "@deskcue/protocol";

import {
  buildPairingWebUrl,
  buildSavedPairingHostOptions,
  readPairingWebOrigin
} from "./helpers";
import { accessPairingController } from "./pairingController";
import type { AccessPairingController } from "./pairingController";

export interface AccessPairingStoreHost {
  clearStatus(): void;
  focusPairingHostsEditor(): void;
  getPairingHosts(): string[];
  refreshAccessDevices(showLoading?: boolean): Promise<void>;
  selectAccessSettingsTab(): void;
  setError(message: string): void;
  setSuccess(message: string): void;
}

export class AccessPairingStore {
  creatingPairingLink = false;
  creatingRecoveryCode = false;
  readonly host: AccessPairingStoreHost;
  pairingHostChoice = "";
  pairingLink: AccessLinkResponse | null = null;
  pairingLinkOrigin = "";
  pairingStatusIntervalId: number | null = null;
  recoveryCode: CreateAccessRecoveryCodeResponse | null = null;
  private readonly controller: AccessPairingController;
  private pairingCreateGeneration = 0;
  private recoveryCreateGeneration = 0;
  private pairingStatusGeneration = 0;
  private pairingStatusRequest: Promise<void> | null = null;

  constructor(
    host: AccessPairingStoreHost,
    controller: AccessPairingController = accessPairingController
  ) {
    this.host = host;
    this.controller = controller;
    makeAutoObservable<this, "controller" | "pairingCreateGeneration" | "recoveryCreateGeneration" | "pairingStatusGeneration" | "pairingStatusRequest">(
      this,
      {
        controller: false,
        host: false,
        pairingLink: observable.ref,
        pairingCreateGeneration: false,
        recoveryCreateGeneration: false,
        pairingStatusGeneration: false,
        pairingStatusIntervalId: false,
        pairingStatusRequest: false,
        recoveryCode: observable.ref
      },
      {
        autoBind: true
      }
    );
  }

  get devicePairingDialogViewModel() {
    if (!this.pairingLink) {
      return null;
    }

    const activePairingWebUrl = buildPairingWebUrl(this.pairingLink, this.pairingLinkOrigin);
    const activePairingOrigin = readPairingWebOrigin(activePairingWebUrl);
    const pairingHostOptions = buildSavedPairingHostOptions(this.host.getPairingHosts());
    const isCustomPairingOrigin = this.pairingHostChoice === "custom";
    const isSavedPairingOrigin = pairingHostOptions.some(
      (option) => option.value === activePairingOrigin
    ) && !isCustomPairingOrigin;

    return {
      activePairingOrigin,
      activePairingWebUrl,
      isCustomPairingOrigin,
      isSavedPairingOrigin,
      pairingHostChoice: this.pairingHostChoice,
      pairingHostOptions,
      pairingLink: this.pairingLink,
      pairingLinkOrigin: this.pairingLinkOrigin
    };
  }

  async createPairingLink() {
    if (this.creatingPairingLink) {
      return;
    }

    this.creatingPairingLink = true;
    this.host.clearStatus();
    const generation = this.pairingCreateGeneration + 1;
    this.pairingCreateGeneration = generation;

    const link = await this.controller.createDevicePairingLink();
    if (generation !== this.pairingCreateGeneration) {
      return;
    }
    runInAction(() => {
      this.creatingPairingLink = false;
    });

    if (!link) {
      runInAction(() => {
        this.clearPairingDialog();
        this.host.setError(`Open ${this.controller.buildCurrentDaemonAccessSettingsUrl()} on the DeskCue host computer to create a device pairing link`);
      });
      return;
    }

    runInAction(() => {
      this.pairingLink = link;
      const savedHostOptions = buildSavedPairingHostOptions(this.host.getPairingHosts());
      const generatedOrigin = readPairingWebOrigin(link.webUrl);
      const initialOrigin = savedHostOptions[0]?.value ?? generatedOrigin;
      this.pairingLinkOrigin = initialOrigin;
      this.pairingHostChoice = savedHostOptions[0]?.value ?? "custom";
      this.host.setSuccess("Device pairing link ready");
      this.startPairingStatusPolling();
    });
  }

  clearPairingDialog() {
    this.stopPairingStatusPolling();
    this.pairingLink = null;
    this.pairingLinkOrigin = "";
    this.pairingHostChoice = "";
  }

  dispose() {
    this.pairingCreateGeneration += 1;
    this.recoveryCreateGeneration += 1;
    this.creatingPairingLink = false;
    this.creatingRecoveryCode = false;
    this.recoveryCode = null;
    this.clearPairingDialog();
  }

  setPairingHostChoice(value: string) {
    this.pairingHostChoice = value;
  }

  setPairingLinkOrigin(value: string) {
    this.pairingLinkOrigin = value;
  }

  managePairingHostsFromPairingDialog() {
    this.clearPairingDialog();
    this.host.clearStatus();
    this.host.selectAccessSettingsTab();
    this.host.focusPairingHostsEditor();
  }

  async copyPairingLink() {
    if (!this.pairingLink) {
      return;
    }

    try {
      await this.controller.writeClipboard(buildPairingWebUrl(this.pairingLink, this.pairingLinkOrigin));
      runInAction(() => {
        this.host.setSuccess("Device pairing link copied");
      });
    } catch {
      runInAction(() => {
        this.host.setError("Copy failed; select the link manually");
      });
    }
  }

  async createRecoveryCode() {
    if (this.creatingRecoveryCode) {
      return;
    }

    const generation = this.recoveryCreateGeneration + 1;
    this.recoveryCreateGeneration = generation;
    const confirmed = await this.controller.requestConfirmation({
      confirmLabel: "Create code",
      description: "Anyone with this code and network access can pair one new browser until it is used or expires.",
      title: "Create a one-time recovery code?"
    });

    if (!confirmed || generation !== this.recoveryCreateGeneration) {
      return;
    }

    this.creatingRecoveryCode = true;
    this.host.clearStatus();

    const result = await this.controller.createRecoveryCode();
    if (generation !== this.recoveryCreateGeneration) {
      return;
    }
    runInAction(() => {
      this.creatingRecoveryCode = false;
    });

    if (result.ok) {
      runInAction(() => {
        this.recoveryCode = result.data;
        this.host.setSuccess("Recovery code created. Store it somewhere safe");
      });
      this.controller.notifySuccess("Recovery code created");
      return;
    }

    runInAction(() => {
      this.host.setError(result.data.error ?? "Failed to create recovery code");
    });
  }

  async copyRecoveryCode() {
    if (!this.recoveryCode) {
      return;
    }

    try {
      await this.controller.writeClipboard(this.recoveryCode.code);
      runInAction(() => {
        this.host.setSuccess("Recovery code copied");
      });
      this.controller.notifySuccess("Recovery code copied");
    } catch {
      runInAction(() => {
        this.host.setError("Could not copy recovery code");
      });
    }
  }

  private startPairingStatusPolling() {
    this.stopPairingStatusPolling();
    void this.checkPairingLinkStatus();
    this.pairingStatusIntervalId = this.controller.setInterval(() => {
      this.checkPairingLinkStatus();
    }, 1500);
  }

  private stopPairingStatusPolling() {
    this.pairingStatusGeneration += 1;
    this.pairingStatusRequest = null;
    if (this.pairingStatusIntervalId !== null) {
      this.controller.clearInterval(this.pairingStatusIntervalId);
      this.pairingStatusIntervalId = null;
    }
  }

  private async checkPairingLinkStatus() {
    const pairingLink = this.pairingLink;
    if (!pairingLink || this.pairingStatusRequest) {
      return;
    }

    const generation = this.pairingStatusGeneration;
    const request = this.fetchPairingLinkStatus(pairingLink, generation);
    this.pairingStatusRequest = request;

    try {
      await request;
    } finally {
      if (
        this.pairingStatusGeneration === generation &&
        this.pairingStatusRequest === request
      ) {
        this.pairingStatusRequest = null;
      }
    }
  }

  private async fetchPairingLinkStatus(
    pairingLink: AccessLinkResponse,
    generation: number
  ) {
    try {
      const result = await this.controller.getDevicePairingLinkStatus(pairingLink.pairCode);
      if (
        generation !== this.pairingStatusGeneration ||
        this.pairingLink?.pairCode !== pairingLink.pairCode
      ) {
        return;
      }

      if (result.status === "active") {
        return;
      }

      runInAction(() => {
        this.clearPairingDialog();
      });

      if (result.status === "used") {
        this.controller.notifySuccess("Device paired");
        runInAction(() => {
          this.host.setSuccess("Device paired. Link closed");
        });
        await this.host.refreshAccessDevices();
        return;
      }

      this.controller.notifyInfo("Device link expired");
      runInAction(() => {
        this.host.setError("Device pairing link expired");
      });
    } catch {
      // Keep the dialog visible if a transient poll fails.
    }
  }
}
