import type { CloudConnectorState, CloudRelaySessionSummary } from "@deskcue/protocol/cloud";
import type { DaemonEventBus } from "#application/ports";
import type {
  CloudConnectorProfile,
  CloudInstallationIdentity
} from "#persistence/cloud/cloudConnectorStore";

import { readCloudSessionProjection } from "../cloudSessionProjection.ts";
import type { CloudProjectionSource } from "../cloudSessionProjection.ts";

const DEFAULT_PROJECTION_INTERVAL_MS = 30_000;
const DEFAULT_EVENT_DEBOUNCE_MS = 250;

type CloudProjectionErrorCode = "outbox_capacity_reached" | "projection_failed";

export type CloudProjectionStore = {
  readActiveProfile: () => CloudConnectorProfile | null;
  readIdentity: () => CloudInstallationIdentity | null;
  enqueueSummaries: (profileId: string, summaries: CloudRelaySessionSummary[]) => number;
  updateState: (
    profileId: string,
    state: CloudConnectorState,
    options: { errorCode?: string | null }
  ) => void;
};

type CloudProjectionCoordinatorOptions = {
  events: DaemonEventBus;
  store: CloudProjectionStore;
  projections: CloudProjectionSource;
  readConnectionEpoch: () => number;
  onProjectionReady: (profile: CloudConnectorProfile) => void;
  onProjectionError: (errorCode: CloudProjectionErrorCode) => void;
  intervalMs?: number;
  eventDebounceMs?: number;
};

function toProjectionErrorCode(error: unknown): CloudProjectionErrorCode {
  return error instanceof Error && error.message.includes("capacity")
    ? "outbox_capacity_reached"
    : "projection_failed";
}

function isValidDelay(value: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;
}

/** Owns projection scheduling and its single-flight durable enqueue lifecycle. */
export class CloudProjectionCoordinator {
  private closed = false;
  private started = false;
  private projectionPromise: Promise<void> | null = null;
  private rerunRequested = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly eventDebounceMs: number;
  private readonly onDaemonEvent = () => this.schedule(this.eventDebounceMs);

  constructor(private readonly options: CloudProjectionCoordinatorOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_PROJECTION_INTERVAL_MS;
    this.eventDebounceMs = options.eventDebounceMs ?? DEFAULT_EVENT_DEBOUNCE_MS;
    if (!isValidDelay(this.intervalMs) || !isValidDelay(this.eventDebounceMs)) {
      throw new Error("Cloud projection timing is invalid.");
    }
  }

  start() {
    if (this.started || this.closed) return;
    this.started = true;
    this.options.events.on("event", this.onDaemonEvent);
    this.intervalTimer = setInterval(() => {
      this.runScheduledProjection();
    }, this.intervalMs);
    this.intervalTimer.unref?.();
  }

  schedule(delayMs: number) {
    if (this.closed) return;
    try {
      if (!this.options.store.readActiveProfile()) return;
    } catch (error) {
      this.reportProjectionError(toProjectionErrorCode(error));
      return;
    }
    if (delayMs === 0) {
      this.runScheduledProjection();
      return;
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.runScheduledProjection();
    }, delayMs);
    this.debounceTimer.unref?.();
  }

  projectNow(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.projectionPromise) {
      this.rerunRequested = true;
      return this.projectionPromise;
    }
    let profile: CloudConnectorProfile | null;
    let identity: CloudInstallationIdentity | null;
    let projectionEpoch: number;
    try {
      profile = this.options.store.readActiveProfile();
      identity = this.options.store.readIdentity();
      projectionEpoch = this.options.readConnectionEpoch();
    } catch (error) {
      this.reportProjectionError(toProjectionErrorCode(error));
      return Promise.resolve();
    }
    if (!profile || !identity) return Promise.resolve();
    const projection = this.runProjection(profile, identity, projectionEpoch);
    this.projectionPromise = projection;
    void projection.then(() => this.finishProjection(projection));
    return this.projectionPromise;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.options.events.off?.("event", this.onDaemonEvent);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    const activeProjection = this.projectionPromise;
    if (activeProjection) await Promise.allSettled([activeProjection]);
  }

  private async runProjection(
    profile: CloudConnectorProfile,
    identity: CloudInstallationIdentity,
    projectionEpoch: number
  ) {
    try {
      const summaries = await readCloudSessionProjection(
        identity.installationId,
        this.options.projections,
        { includeLabels: profile.sessionLabelDisclosureEnabled === true }
      );
      if (!this.isCurrent(profile, projectionEpoch)) return;
      this.options.store.enqueueSummaries(profile.id, summaries);
      this.options.onProjectionReady(profile);
    } catch (error) {
      this.recoverProjectionFailure(profile, projectionEpoch, error);
    }
  }

  private recoverProjectionFailure(
    profile: CloudConnectorProfile,
    projectionEpoch: number,
    error: unknown
  ) {
    const errorCode = toProjectionErrorCode(error);
    let currentProfile: CloudConnectorProfile | null;
    try {
      if (this.closed || this.options.readConnectionEpoch() !== projectionEpoch) return;
      currentProfile = this.options.store.readActiveProfile();
    } catch {
      this.reportProjectionError(errorCode);
      return;
    }
    if (currentProfile?.id !== profile.id) return;
    try {
      this.options.store.updateState(
        profile.id,
        errorCode === "outbox_capacity_reached" ? "degraded" : currentProfile.state,
        { errorCode }
      );
    } catch {
      // Store recovery is best-effort. The local daemon must remain available
      // even when the Cloud state database cannot record the secondary error.
    }
    this.reportProjectionError(errorCode);
  }

  private reportProjectionError(errorCode: CloudProjectionErrorCode) {
    try {
      this.options.onProjectionError(errorCode);
    } catch {
      // Cloud diagnostics callbacks are isolated from the local daemon loop.
    }
  }

  private isCurrent(profile: CloudConnectorProfile, projectionEpoch: number) {
    if (this.closed) return false;
    return this.options.readConnectionEpoch() === projectionEpoch &&
      this.options.store.readActiveProfile()?.id === profile.id;
  }

  private finishProjection(projection: Promise<void>) {
    if (this.projectionPromise !== projection) return;
    this.projectionPromise = null;
    if (this.rerunRequested && !this.closed) {
      this.rerunRequested = false;
      this.runScheduledProjection();
    }
  }

  private runScheduledProjection() {
    try {
      void this.projectNow().catch((error) => {
        this.reportProjectionError(toProjectionErrorCode(error));
      });
    } catch (error) {
      this.reportProjectionError(toProjectionErrorCode(error));
    }
  }
}
