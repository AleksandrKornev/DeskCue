import { makeAutoObservable, observable, runInAction } from "mobx";

import type { DaemonLogEntry } from "@deskcue/protocol";
import { daemonLogsController } from "@modules/logs/controller/daemonLogsController";
import type { DaemonLogsController } from "@modules/logs/controller/daemonLogsController";

export const DAEMON_LOG_AUTO_REFRESH_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "2s", value: 2000 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
  { label: "30s", value: 30000 }
] as const;

export class DaemonLogsStore {
  entries: DaemonLogEntry[] = [];
  filePath: string | null = null;
  status = "";
  loading = false;
  autoRefreshMs = 5000;
  private hasLoaded = false;
  private readonly controller: DaemonLogsController;
  private refreshInFlight = false;
  private requestGeneration = 0;

  constructor(controller: DaemonLogsController = daemonLogsController) {
    this.controller = controller;
    makeAutoObservable<this, "controller" | "hasLoaded" | "refreshInFlight" | "requestGeneration">(
      this,
      {
        controller: false,
        entries: observable.ref,
        hasLoaded: false,
        refreshInFlight: false,
        requestGeneration: false
      },
      {
        autoBind: true
      }
    );
  }

  get latestEntries() {
    return this.entries.slice().reverse();
  }

  setAutoRefreshMs(value: number) {
    this.autoRefreshMs = value;
  }

  loadOnMount() {
    if (this.hasLoaded) {
      return;
    }

    this.hasLoaded = true;
    void this.refresh();
  }

  async refresh(showLoading = true) {
    if (this.refreshInFlight) {
      return;
    }

    this.refreshInFlight = true;
    if (showLoading) {
      this.loading = true;
    }
    this.status = "";
    const generation = this.requestGeneration;

    try {
      const payload = await this.controller.getLogs(300);
      if (generation !== this.requestGeneration) {
        return;
      }
      runInAction(() => {
        this.entries = payload.entries;
        this.filePath = payload.filePath;
        this.status = payload.truncated ? "Showing the latest daemon log entries" : "";
      });
    } catch (error) {
      if (generation !== this.requestGeneration) {
        return;
      }
      runInAction(() => {
        this.status = error instanceof Error ? error.message : "Failed to load system logs";
      });
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.refreshInFlight = false;
          if (showLoading) {
            this.loading = false;
          }
        });
      }
    }
  }

  resetForConnectionChange() {
    this.requestGeneration += 1;
    this.entries = [];
    this.filePath = null;
    this.status = "";
    this.loading = false;
    this.hasLoaded = false;
    this.refreshInFlight = false;
  }
}
