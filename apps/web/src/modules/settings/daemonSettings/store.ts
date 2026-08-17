import { makeAutoObservable, observable, runInAction } from "mobx";

import type {
  DaemonSettingsResponse,
  SecurityStatusResponse
} from "@deskcue/protocol";

import { daemonSettingsController } from "./controller";
import type { DaemonSettingsController } from "./controller";
import {
  createSettingsDraft,
  normalizeAgentDataRootsDraft,
  normalizeRuntimeEndpointsDraft,
  parseAllowedOriginsText,
  parseListRows
} from "./helpers";
import type { DaemonSettingsStatus, SettingsDraft } from "./types";

export class DaemonSettingsStore {
  daemonSettings: DaemonSettingsResponse | null = null;
  daemonSettingsDraft: SettingsDraft | null = null;
  daemonSettingsStatus: DaemonSettingsStatus = null;
  hasLoadedDaemonSettings = false;
  loadingDaemonSettings = false;
  resettingDaemonSettings = false;
  savingDaemonSettings = false;
  securityStatus: SecurityStatusResponse | null = null;
  securityStatusMessage = "";
  private readonly controller: DaemonSettingsController;
  private requestGeneration = 0;

  constructor(controller: DaemonSettingsController = daemonSettingsController) {
    this.controller = controller;
    makeAutoObservable<this, "controller" | "requestGeneration">(
      this,
      {
        daemonSettings: observable.ref,
        daemonSettingsDraft: observable.ref,
        daemonSettingsStatus: observable.ref,
        controller: false,
        requestGeneration: false,
        securityStatus: observable.ref
      },
      {
        autoBind: true
      }
    );
  }

  loadDaemonSettings() {
    if (this.hasLoadedDaemonSettings || this.loadingDaemonSettings) {
      return;
    }

    void this.refreshDaemonSettings();
  }

  async refreshDaemonSettings() {
    const generation = this.requestGeneration;
    this.loadingDaemonSettings = true;

    try {
      const [status, settings] = await Promise.all([
        this.controller.fetchSecurityStatus(),
        this.controller.getDaemonSettings()
      ]);
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.securityStatus = status;
        this.syncDaemonSettings(settings);
        this.hasLoadedDaemonSettings = true;
      });
    } catch (error: unknown) {
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.securityStatusMessage =
          error instanceof Error ? error.message : "Failed to load security status";
        this.hasLoadedDaemonSettings = true;
      });
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.loadingDaemonSettings = false;
        });
      }
    }
  }

  async refreshSecurityStatus() {
    const generation = this.requestGeneration;
    try {
      const securityStatus = await this.controller.fetchSecurityStatus();
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.securityStatus = securityStatus;
      });
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.securityStatusMessage =
          error instanceof Error ? error.message : "Failed to load security status";
      });
    }
  }

  syncDaemonSettings(settings: DaemonSettingsResponse) {
    this.daemonSettings = settings;
    this.daemonSettingsDraft = createSettingsDraft(settings);
  }

  updateSettingsDraft(updater: (current: SettingsDraft) => SettingsDraft) {
    this.daemonSettingsDraft = this.daemonSettingsDraft
      ? updater(this.daemonSettingsDraft)
      : this.daemonSettingsDraft;
  }

  onPairingHostChange(index: number, value: string) {
    this.updateSettingsDraft((current) => ({
      ...current,
      pairingHosts: current.pairingHosts.map((host, hostIndex) =>
        hostIndex === index ? value : host
      )
    }));
  }

  onAddPairingHost() {
    this.updateSettingsDraft((current) => {
      if (current.pairingHosts.some((host) => !host.trim())) {
        return current;
      }

      return {
        ...current,
        pairingHosts: [...current.pairingHosts, ""]
      };
    });
  }

  onRemovePairingHost(index: number) {
    this.updateSettingsDraft((current) => ({
      ...current,
      pairingHosts: current.pairingHosts.filter((_, hostIndex) => hostIndex !== index)
    }));
  }

  onAuthRequiredChange(authRequired: boolean) {
    this.updateSettingsDraft((current) => ({
      ...current,
      authRequired
    }));
  }

  onAllowedOriginsTextChange(allowedOriginsText: string) {
    this.updateSettingsDraft((current) => ({
      ...current,
      allowedOriginsText
    }));
  }

  onPublicHostChange(publicHost: string) {
    this.updateSettingsDraft((current) => ({
      ...current,
      publicHost
    }));
  }

  onAgentDataRootChange(
    fieldName: keyof DaemonSettingsResponse["agentDataRoots"],
    value: string
  ) {
    this.updateSettingsDraft((current) => ({
      ...current,
      agentDataRoots: {
        ...current.agentDataRoots,
        [fieldName]: value
      }
    }));
  }

  onRuntimeEndpointChange(
    fieldName: keyof DaemonSettingsResponse["runtimeEndpoints"],
    value: string
  ) {
    this.updateSettingsDraft((current) => ({
      ...current,
      runtimeEndpoints: {
        ...current.runtimeEndpoints,
        [fieldName]: value
      }
    }));
  }

  async onSaveDaemonSettings() {
    if (
      !this.daemonSettingsDraft ||
      this.savingDaemonSettings ||
      this.resettingDaemonSettings
    ) {
      return;
    }

    const generation = this.requestGeneration;
    this.savingDaemonSettings = true;
    this.daemonSettingsStatus = null;

    try {
      const result = await this.controller.updateDaemonSettings({
        authRequired: this.daemonSettingsDraft.authRequired,
        publicHost: this.daemonSettingsDraft.publicHost.trim() || null,
        pairingHosts: parseListRows(this.daemonSettingsDraft.pairingHosts),
        allowedOrigins: parseAllowedOriginsText(this.daemonSettingsDraft.allowedOriginsText),
        storageMaxMb: this.daemonSettingsDraft.storageMaxMb,
        agentDataRoots: normalizeAgentDataRootsDraft(this.daemonSettingsDraft.agentDataRoots),
        runtimeEndpoints: normalizeRuntimeEndpointsDraft(this.daemonSettingsDraft.runtimeEndpoints)
      });
      if (generation !== this.requestGeneration) return;

      if (result.ok) {
        runInAction(() => {
          this.syncDaemonSettings(result.data);
        });
        this.controller.notifySaved();
        await this.refreshSecurityStatus();
        return;
      }

      runInAction(() => {
        this.daemonSettingsStatus = {
          kind: "error",
          message: result.data.error ?? "Failed to save settings"
        };
      });
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.daemonSettingsStatus = {
          kind: "error",
          message: error instanceof Error ? error.message : "Failed to save settings"
        };
      });
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.savingDaemonSettings = false;
        });
      }
    }
  }

  async onResetDaemonSettings() {
    if (this.savingDaemonSettings || this.resettingDaemonSettings) {
      return;
    }

    const generation = this.requestGeneration;
    const confirmed = await this.controller.requestResetConfirmation();

    if (!confirmed || generation !== this.requestGeneration) {
      return;
    }

    this.resettingDaemonSettings = true;
    this.daemonSettingsStatus = null;

    try {
      const result = await this.controller.resetDaemonSettings();
      if (generation !== this.requestGeneration) return;

      if (result.ok) {
        runInAction(() => {
          this.syncDaemonSettings(result.data);
        });
        this.controller.notifyReset();
        await this.refreshSecurityStatus();
        return;
      }

      runInAction(() => {
        this.daemonSettingsStatus = {
          kind: "error",
          message: result.data.error ?? "Failed to reset settings"
        };
      });
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.resettingDaemonSettings = false;
        });
      }
    }
  }

  resetForConnectionChange() {
    this.requestGeneration += 1;
    this.daemonSettings = null;
    this.daemonSettingsDraft = null;
    this.daemonSettingsStatus = null;
    this.hasLoadedDaemonSettings = false;
    this.loadingDaemonSettings = false;
    this.resettingDaemonSettings = false;
    this.savingDaemonSettings = false;
    this.securityStatus = null;
    this.securityStatusMessage = "";
  }
}
