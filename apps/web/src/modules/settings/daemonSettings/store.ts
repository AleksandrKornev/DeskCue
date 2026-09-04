import { makeAutoObservable, observable, runInAction } from "mobx";

import type {
  DaemonSettingsResponse,
  SecurityStatusResponse
} from "@deskcue/protocol";
import { SettingsMutationCoordinator } from "@modules/settings/settingsMutationCoordinator";

import { daemonSettingsController } from "./controller";
import type { DaemonSettingsController } from "./controller";
import {
  createSettingsDraft,
  mergeSettingsDraftWithBaseline,
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
  settingsConnectionRevision = 0;
  settingsSaveSuccessRevision = 0;
  securityStatus: SecurityStatusResponse | null = null;
  securityStatusMessage = "";
  private readonly controller: DaemonSettingsController;
  private readonly settingsMutationCoordinator: SettingsMutationCoordinator;
  private requestGeneration = 0;

  constructor(
    controller: DaemonSettingsController = daemonSettingsController,
    settingsMutationCoordinator = new SettingsMutationCoordinator()
  ) {
    this.controller = controller;
    this.settingsMutationCoordinator = settingsMutationCoordinator;
    makeAutoObservable<this, "controller" | "requestGeneration" | "settingsMutationCoordinator">(
      this,
      {
        daemonSettings: observable.ref,
        daemonSettingsDraft: observable.ref,
        daemonSettingsStatus: observable.ref,
        controller: false,
        requestGeneration: false,
        securityStatus: observable.ref,
        settingsMutationCoordinator: false
      },
      {
        autoBind: true
      }
    );
  }

  get settingsMutationPending() {
    return this.settingsMutationCoordinator.pendingMutation !== null;
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

  syncDaemonSettingsPreservingDraft(settings: DaemonSettingsResponse) {
    const previousSettings = this.daemonSettings;
    const currentDraft = this.daemonSettingsDraft;

    this.daemonSettings = settings;
    this.daemonSettingsDraft = previousSettings && currentDraft
      ? mergeSettingsDraftWithBaseline(createSettingsDraft(previousSettings), currentDraft, settings)
      : createSettingsDraft(settings);
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

    const mutationToken = this.settingsMutationCoordinator.tryStart("daemon");

    if (mutationToken === null) return;

    const generation = this.requestGeneration;
    const submittedDraft = this.daemonSettingsDraft;

    this.savingDaemonSettings = true;

    this.daemonSettingsStatus = null;

    try {
      const result = await this.controller.updateDaemonSettings({
        authRequired: submittedDraft.authRequired,
        publicHost: submittedDraft.publicHost.trim() || null,
        pairingHosts: parseListRows(submittedDraft.pairingHosts),
        allowedOrigins: parseAllowedOriginsText(submittedDraft.allowedOriginsText),
        storageMaxMb: submittedDraft.storageMaxMb,
        agentDataRoots: normalizeAgentDataRootsDraft(submittedDraft.agentDataRoots),
        runtimeEndpoints: normalizeRuntimeEndpointsDraft(submittedDraft.runtimeEndpoints)
      });

      if (generation !== this.requestGeneration) return;

      if (result.ok) {
        runInAction(() => {
          this.daemonSettings = result.data;
          if (this.daemonSettingsDraft === submittedDraft) {
            this.daemonSettingsDraft = createSettingsDraft(result.data);
          } else if (this.daemonSettingsDraft) {
            this.daemonSettingsDraft = mergeSettingsDraftWithBaseline(
              submittedDraft,
              this.daemonSettingsDraft,
              result.data
            );
          }

          this.settingsSaveSuccessRevision += 1;
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
      this.settingsMutationCoordinator.finish(mutationToken);

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

    const mutationToken = this.settingsMutationCoordinator.tryStart("daemon");

    if (mutationToken === null) return;

    const resetDraft = this.daemonSettingsDraft;

    this.resettingDaemonSettings = true;
    this.daemonSettingsStatus = null;

    try {
      const result = await this.controller.resetDaemonSettings();

      if (generation !== this.requestGeneration) return;

      if (result.ok) {
        runInAction(() => {
          if (this.daemonSettingsDraft === resetDraft) {
            this.syncDaemonSettings(result.data);
          } else if (this.daemonSettingsDraft && resetDraft) {
            this.daemonSettings = result.data;
            this.daemonSettingsDraft = mergeSettingsDraftWithBaseline(
              resetDraft,
              this.daemonSettingsDraft,
              result.data
            );
          }
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
      this.settingsMutationCoordinator.finish(mutationToken);

      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.resettingDaemonSettings = false;
        });
      }
    }
  }

  resetForConnectionChange() {
    this.settingsMutationCoordinator.reset();
    this.requestGeneration += 1;
    this.settingsConnectionRevision += 1;
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
