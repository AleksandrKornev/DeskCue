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
  statusIsError = false;
  loading = false;
  refreshing = false;
  autoRefreshMs = 5000;
  private hasLoaded = false;
  private readonly controller: DaemonLogsController;
  private requestGeneration = 0;

  constructor(controller: DaemonLogsController = daemonLogsController) {
    this.controller = controller;
    makeAutoObservable<this, "controller" | "hasLoaded" | "requestGeneration">(
      this,
      {
        controller: false,
        entries: observable.ref,
        hasLoaded: false,
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

  handleConnectionConfigChanged() {
    this.resetForConnectionChange();
    this.loadOnMount();
  }

  async refresh(showLoading = true) {
    if (this.refreshing) {
      return;
    }

    this.refreshing = true;
    if (showLoading) {
      this.loading = true;
      this.status = "";
      this.statusIsError = false;
    }

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
        this.statusIsError = false;
      });
    } catch (error) {
      if (generation !== this.requestGeneration) {
        return;
      }

      runInAction(() => {
        this.status = error instanceof Error ? error.message : "Failed to load system logs";
        this.statusIsError = true;
      });
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.refreshing = false;
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
    this.statusIsError = false;
    this.loading = false;
    this.refreshing = false;
    this.hasLoaded = false;
  }
}
