import { join } from "node:path";

import type { HostStatus } from "@deskcue/host-control";
import {
  createInitialUpdateState,
  FileUpdateStateStore,
  launchLinuxArchiveApplyHandoff,
  launchInstallerApplyHandoff,
  UpdateManager
} from "@deskcue/update";
import type {
  InstallerApplyHandoff,
  UpdateArchitecture,
  UpdateChannel,
  UpdateManagerOptions,
  UpdatePlatform,
  UpdateState
} from "@deskcue/update";

import { HostOperationError } from "./hostOperationError.ts";

const DEFAULT_UPDATE_MANIFEST_URL =
  "https://github.com/AleksandrKornev/DeskCue/releases/latest/download/update-manifest-v1.json";
const DEFAULT_BETA_UPDATE_MANIFEST_URL =
  "https://github.com/AleksandrKornev/DeskCue/releases/latest/download/update-manifest-v1-beta.json";
const DEFAULT_UPDATE_ALLOWED_HOSTS = [
  "github.com",
  "release-assets.githubusercontent.com"
] as const;
const DEFAULT_UPDATE_REQUEST_TIMEOUT_MS = 15_000;
const MAX_UPDATE_CHECK_DURATION_MS = 60_000;
const MAX_UPDATE_STAGE_DURATION_MS = 30 * 60_000;

type UpdateManagerLike = Pick<
  UpdateManager,
  | "cancelActiveOperation"
  | "checkForUpdate"
  | "downloadAvailableUpdate"
  | "prepareApply"
  | "readState"
  | "reconcileInstalledVersion"
  | "recordApplyLaunchFailure"
>;

type HostUpdateServiceOptions = {
  architecture?: NodeJS.Architecture;
  createManager?: (options: UpdateManagerOptions) => UpdateManagerLike;
  currentVersion: string;
  dataRootPath: string;
  env?: NodeJS.ProcessEnv;
  launchInstaller?: typeof launchInstallerApplyHandoff;
  onStatusChange?: () => void;
  platform?: NodeJS.Platform;
};

function parseChannel(value: unknown, fallback: UpdateChannel): UpdateChannel {
  if (value === undefined) return fallback;
  if (value === "stable" || value === "beta") return value;

  throw new HostOperationError("invalid_update_channel", "Update channel must be stable or beta.");
}

function parseAllowedHosts(env: NodeJS.ProcessEnv, manifestUrl: string) {
  const configured = env.DESKCUE_UPDATE_ALLOWED_HOSTS?.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean) ?? [];
  const manifestHost = new URL(manifestUrl).hostname.toLowerCase();

  return [...new Set([...DEFAULT_UPDATE_ALLOWED_HOSTS, manifestHost, ...configured])];
}

function resolveArchitecture(architecture: NodeJS.Architecture): UpdateArchitecture | null {
  if (architecture === "x64" || architecture === "arm64") return architecture;

  return null;
}

function resolvePlatform(platform: NodeJS.Platform): UpdatePlatform | null {
  if (platform === "win32" || platform === "linux") return platform;

  return null;
}

function resolveLinuxInstallRoot(env: NodeJS.ProcessEnv) {
  return env.DESKCUE_INSTALL_DIR?.trim() || null;
}

function resolveManifestUrl(env: NodeJS.ProcessEnv, channel: UpdateChannel) {
  const configured = env.DESKCUE_UPDATE_MANIFEST_URL?.trim();

  if (configured) return configured.replaceAll("{channel}", channel);

  return channel === "beta" ? DEFAULT_BETA_UPDATE_MANIFEST_URL : DEFAULT_UPDATE_MANIFEST_URL;
}

function toHostUpdateStatus(state: UpdateState): HostStatus["update"] {
  return {
    availableVersion: state.targetVersion,
    lastError: state.error?.message ?? null,
    state: state.phase
  };
}

function createFailedState(
  architecture: UpdateArchitecture,
  channel: UpdateChannel,
  currentVersion: string,
  error: unknown
): UpdateState {
  return {
    ...createInitialUpdateState({ architecture, channel, currentVersion }),
    error: {
      code: (error as { code?: string } | null)?.code ?? "update_state_failed",
      message: error instanceof Error ? error.message : String(error)
    },
    phase: "failed"
  };
}

export class HostUpdateService {
  private readonly architecture: UpdateArchitecture | null;
  private readonly createManager: (options: UpdateManagerOptions) => UpdateManagerLike;
  private readonly defaultChannel: UpdateChannel;
  private readonly env: NodeJS.ProcessEnv;
  private readonly launchInstaller: typeof launchInstallerApplyHandoff;
  private readonly platform: UpdatePlatform | null;
  private manager: UpdateManagerLike | null = null;
  private managerChannel: UpdateChannel | null = null;
  private state: UpdateState | null = null;
  readonly supported: boolean;

  constructor(private readonly options: HostUpdateServiceOptions) {
    this.env = options.env ?? process.env;
    this.architecture = resolveArchitecture(options.architecture ?? process.arch);
    this.platform = resolvePlatform(options.platform ?? process.platform);
    this.createManager = options.createManager ?? ((managerOptions) => new UpdateManager(managerOptions));
    this.defaultChannel = parseChannel(this.env.DESKCUE_UPDATE_CHANNEL, "stable");
    this.launchInstaller = options.launchInstaller ?? (
      this.platform === "linux"
        ? (handoff) => launchLinuxArchiveApplyHandoff(handoff, {
            installRootPath: resolveLinuxInstallRoot(this.env) ?? "",
            platform: this.platform ?? undefined
          })
        : launchInstallerApplyHandoff
    );
    const installedMode = this.env.DESKCUE_DISTRIBUTION_MODE === "installed";
    const linuxStandalone = this.platform === "linux" &&
      this.env.DESKCUE_UPDATE_APPLY_MODE === "linux-standalone" &&
      resolveLinuxInstallRoot(this.env) !== null;

    this.supported = installedMode && this.architecture !== null && (
      this.platform === "win32" || linuxStandalone
    );
  }

  get status(): HostStatus["update"] {
    if (!this.state) {
      return { availableVersion: null, lastError: null, state: "idle" };
    }

    return toHostUpdateStatus(this.state);
  }

  async initialize() {
    if (!this.supported || !this.architecture) return this.status;

    try {
      const manager = this.ensureManager(this.defaultChannel);

      this.state = await manager.reconcileInstalledVersion();
    } catch (error) {
      this.state = createFailedState(
        this.architecture,
        this.defaultChannel,
        this.options.currentVersion,
        error
      );
    }

    this.options.onStatusChange?.();

    return this.status;
  }

  async check(params?: Record<string, unknown>) {
    this.assertSupported();
    const channel = parseChannel(params?.channel, this.defaultChannel);
    const manager = await this.selectManager(channel);

    await this.refresh(manager);
    this.setTransientPhase("checking");
    const timeout = setTimeout(() => manager.cancelActiveOperation(), MAX_UPDATE_CHECK_DURATION_MS);

    timeout.unref?.();

    try {
      await this.runAndRefresh(manager, () => manager.checkForUpdate());
    } finally {
      clearTimeout(timeout);
    }

    return this.status;
  }

  async stageAvailable(params?: Record<string, unknown>) {
    this.assertSupported();
    const channel = parseChannel(params?.channel, this.managerChannel ?? this.defaultChannel);
    const manager = await this.selectManager(channel);

    await this.refresh(manager);
    if (params?.version !== undefined && params.version !== this.state?.targetVersion) {
      throw new HostOperationError("update_version_changed", "The checked DeskCue update version changed.");
    }

    if (this.state?.phase === "available") {
      this.setTransientPhase("downloading");
      const timeout = setTimeout(() => manager.cancelActiveOperation(), MAX_UPDATE_STAGE_DURATION_MS);

      timeout.unref?.();

      try {
        await this.runAndRefresh(manager, () => manager.downloadAvailableUpdate());
      } finally {
        clearTimeout(timeout);
      }
    }

    if (this.state?.phase !== "staged") {
      throw new HostOperationError("update_not_staged", "No verified DeskCue update is ready to install.");
    }

    return this.status;
  }

  async prepareApply() {
    const manager = this.requireManager();

    this.setTransientPhase("applying");
    return this.runAndRefresh(manager, () => manager.prepareApply());
  }

  async launchApply(handoff: InstallerApplyHandoff) {
    const manager = this.requireManager();

    try {
      return await this.launchInstaller(handoff);
    } catch (error) {
      await manager.recordApplyLaunchFailure(error);
      await this.refresh(manager);
      throw error;
    }
  }

  async abortApply(error: unknown) {
    const manager = this.requireManager();

    await manager.recordApplyLaunchFailure(error);
    await this.refresh(manager);

    return this.status;
  }

  cancelActiveOperation() {
    return this.manager?.cancelActiveOperation() ?? false;
  }

  private assertSupported() {
    if (this.supported) return;

    if (this.platform === "linux" && this.env.DESKCUE_UPDATE_APPLY_MODE === "external") {
      throw new HostOperationError(
        "update_unsupported",
        "This Debian installation is updated outside DeskCue; repeat the Debian install command from the installation guide or use sudo dpkg -i with a newer package."
      );
    }

    throw new HostOperationError(
      "update_unsupported",
      "DeskCue self-updates are available in installed Windows builds and standalone Linux builds."
    );
  }

  private ensureManager(channel: UpdateChannel) {
    if (this.manager && this.managerChannel === channel) return this.manager;

    if (!this.architecture || !this.platform) {
      throw new HostOperationError("update_unsupported", "Update target is unsupported.");
    }

    const manifestUrl = resolveManifestUrl(this.env, channel);
    const stateStore = new FileUpdateStateStore(
      join(this.options.dataRootPath, "service", "update-state.json"),
      createInitialUpdateState({
        architecture: this.architecture,
        channel,
        currentVersion: this.options.currentVersion
      })
    );

    this.manager = this.createManager({
      allowedHosts: parseAllowedHosts(this.env, manifestUrl),
      architecture: this.architecture,
      channel,
      currentVersion: this.options.currentVersion,
      manifestUrl,
      platform: this.platform,
      requestTimeoutMs: DEFAULT_UPDATE_REQUEST_TIMEOUT_MS,
      stageDirectory: join(this.options.dataRootPath, "service", "updates", "staged"),
      stateStore
    });
    this.managerChannel = channel;

    return this.manager;
  }

  private requireManager() {
    if (!this.manager) throw new HostOperationError("update_not_checked", "Check for updates before installing.");

    return this.manager;
  }

  private async selectManager(channel: UpdateChannel) {
    const channelChanged = this.managerChannel !== channel;
    const manager = this.ensureManager(channel);

    if (channelChanged) {
      this.state = await manager.reconcileInstalledVersion();
      this.options.onStatusChange?.();
    }

    return manager;
  }

  private async refresh(manager: UpdateManagerLike) {
    this.state = await manager.readState();
    this.options.onStatusChange?.();

    return this.state;
  }

  private async runAndRefresh<T>(manager: UpdateManagerLike, operation: () => Promise<T>) {
    try {
      return await operation();
    } finally {
      await this.refresh(manager);
    }
  }

  private setTransientPhase(phase: UpdateState["phase"]) {
    if (!this.state) return;

    this.state = { ...this.state, error: null, phase };
    this.options.onStatusChange?.();
  }
}
