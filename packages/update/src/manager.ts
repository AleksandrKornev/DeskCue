import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  DEFAULT_UPDATE_ARTIFACT_MAX_BYTES,
  DEFAULT_UPDATE_MANIFEST_MAX_BYTES,
  downloadUpdateArtifact,
  readBoundedUpdateResponse
} from "./download.ts";
import type { UpdateDownloadProgress } from "./download.ts";
import { UpdateError, toUpdateError } from "./errors.ts";
import {
  compareUpdateVersions,
  parseUpdateManifestJson,
  selectUpdateArtifact
} from "./manifest.ts";
import type {
  UpdateArchitecture,
  UpdateArtifact,
  UpdateChannel,
  UpdateManifest
} from "./manifest.ts";
import {
  cleanupUpdateStageArtifacts,
  prepareInstallerApplyHandoff,
  verifyStagedUpdateArtifact,
  WINDOWS_INNO_UPDATE_ARGUMENTS
} from "./apply.ts";
import type { InstallerApplyHandoff } from "./apply.ts";
import type { UpdateFetch } from "./sourcePolicy.ts";
import { assertAllowedUpdateUrl } from "./sourcePolicy.ts";
import {
  createInitialUpdateState,
  FileUpdateStateStore,
  withUpdateFailure
} from "./stateStore.ts";
import type { UpdateState } from "./stateStore.ts";

export type UpdateCheckResult = {
  available: boolean;
  currentVersion: string;
  manifest: UpdateManifest;
  selectedArtifact: UpdateArtifact;
};

export type UpdateManagerOptions = {
  allowedHosts: readonly string[];
  architecture: UpdateArchitecture;
  channel: UpdateChannel;
  currentVersion: string;
  fetch?: UpdateFetch;
  manifestUrl: string;
  maxArtifactBytes?: number;
  artifactInactivityTimeoutMs?: number;
  maxManifestBytes?: number;
  manifestInactivityTimeoutMs?: number;
  now?: () => Date;
  requestTimeoutMs: number;
  stageDirectory: string;
  stateStore: FileUpdateStateStore;
};

type ActiveOperation = {
  controller: AbortController;
  kind: "check" | "download";
  promise: Promise<unknown>;
};

function decodeManifest(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new UpdateError("invalid_manifest", "Update manifest is not valid UTF-8.", {
      cause: error
    });
  }
}

function stagedInstallerName(version: string, architecture: UpdateArchitecture) {
  return `DeskCueSetup-${version}-win-${architecture}.exe`;
}

function preservedStageInstallerPaths(
  state: UpdateState,
  stageDirectory: string,
  architecture: UpdateArchitecture
) {
  const paths = state.stagedPath ? [state.stagedPath] : [];

  if (state.targetVersion && /^[0-9A-Za-z.+-]+$/.test(state.targetVersion)) {
    paths.push(join(stageDirectory, stagedInstallerName(state.targetVersion, architecture)));
  }

  return paths;
}

async function reuseExistingStagedArtifact(path: string, artifact: UpdateArtifact) {
  try {
    await verifyStagedUpdateArtifact(path, artifact);
    return true;
  } catch (error) {
    if (
      error instanceof UpdateError &&
      (error.code === "missing_staged_artifact" || error.code === "staged_artifact_changed")
    ) {
      await rm(path, { force: true });
      return false;
    }

    throw error;
  }
}

export class UpdateManager {
  private activeOperation: ActiveOperation | null = null;

  constructor(private readonly options: UpdateManagerOptions) {}

  readState() {
    return this.options.stateStore.read();
  }

  async reconcileInstalledVersion() {
    const state = await this.readState();

    await this.cleanupStageArtifacts(state);

    if (
      state.channel !== this.options.channel ||
      state.architecture !== this.options.architecture
    ) {
      const distributionChanged = createInitialUpdateState({
        architecture: this.options.architecture,
        channel: this.options.channel,
        currentVersion: this.options.currentVersion,
        now: () => this.now()
      });

      await this.options.stateStore.write(distributionChanged);
      await this.cleanupStageArtifacts(distributionChanged);

      return distributionChanged;
    }

    if (state.phase === "applying" && state.targetVersion === this.options.currentVersion) {
      const installed = createInitialUpdateState({
        architecture: this.options.architecture,
        channel: this.options.channel,
        currentVersion: this.options.currentVersion,
        now: () => this.now()
      });

      await this.options.stateStore.write(installed);
      await this.cleanupStageArtifacts(installed);

      return installed;
    }

    if (state.phase === "applying" && state.currentVersion === this.options.currentVersion) {
      try {
        if (!state.artifact || !state.stagedPath || !state.targetVersion) {
          throw new UpdateError("missing_staged_artifact", "Incomplete update has no staged installer metadata.");
        }

        await verifyStagedUpdateArtifact(state.stagedPath, state.artifact);
        const retryable: UpdateState = {
          ...state,
          error: {
            code: "apply_incomplete",
            message: "The previous update did not install. The verified installer can be retried."
          },
          phase: "staged",
          updatedAt: this.now().toISOString()
        };

        await this.options.stateStore.write(retryable);

        return retryable;
      } catch (error) {
        const updateError = toUpdateError(error, "apply_incomplete");
        const failed = withUpdateFailure(state, updateError, this.now());

        await this.options.stateStore.write(failed);

        return failed;
      }
    }

    if (state.phase === "checking" && state.currentVersion === this.options.currentVersion) {
      const interruptedCheck: UpdateState = {
        ...createInitialUpdateState({
          architecture: this.options.architecture,
          channel: this.options.channel,
          currentVersion: this.options.currentVersion,
          now: () => this.now()
        }),
        error: {
          code: "check_interrupted",
          message: "The previous update check was interrupted and can be retried."
        }
      };

      await this.options.stateStore.write(interruptedCheck);
      await this.cleanupStageArtifacts(interruptedCheck);

      return interruptedCheck;
    }

    if (state.phase === "downloading" && state.currentVersion === this.options.currentVersion) {
      try {
        if (!state.artifact || !state.targetVersion) {
          throw new UpdateError("invalid_state", "Interrupted download has no artifact metadata.");
        }

        if (
          state.artifact.architecture !== this.options.architecture ||
          state.artifact.platform !== "win32" ||
          state.totalBytes !== state.artifact.sizeBytes ||
          compareUpdateVersions(state.targetVersion, this.options.currentVersion) <= 0
        ) {
          throw new UpdateError("invalid_state", "Interrupted download metadata is inconsistent.");
        }

        assertAllowedUpdateUrl(state.artifact.url, this.options.allowedHosts);
        const destinationPath = join(
          this.options.stageDirectory,
          stagedInstallerName(state.targetVersion, this.options.architecture)
        );

        await rm(`${destinationPath}.part`, { force: true });
        const artifactAlreadyStaged = await reuseExistingStagedArtifact(
          destinationPath,
          state.artifact
        );
        const recoveredDownload: UpdateState = {
          ...state,
          error: {
            code: "download_interrupted",
            message: artifactAlreadyStaged
              ? "The previous download finished before DeskCue restarted."
              : "The previous download was interrupted and can be retried."
          },
          phase: artifactAlreadyStaged ? "staged" : "available",
          progressBytes: artifactAlreadyStaged ? state.artifact.sizeBytes : 0,
          stagedPath: artifactAlreadyStaged ? destinationPath : null,
          updatedAt: this.now().toISOString()
        };

        await this.options.stateStore.write(recoveredDownload);

        return recoveredDownload;
      } catch (error) {
        const updateError = toUpdateError(error, "download_interrupted");
        const failed = withUpdateFailure(state, updateError, this.now());

        await this.options.stateStore.write(failed);

        return failed;
      }
    }

    if (state.currentVersion === this.options.currentVersion) return state;

    const reconciled = createInitialUpdateState({
      architecture: this.options.architecture,
      channel: this.options.channel,
      currentVersion: this.options.currentVersion,
      now: () => this.now()
    });

    await this.options.stateStore.write(reconciled);
    await this.cleanupStageArtifacts(reconciled);

    return reconciled;
  }

  checkForUpdate(): Promise<UpdateCheckResult> {
    return this.runSingleFlight("check", async (signal) => {
      const previous = await this.readState();

      await this.writeState({
        ...previous,
        error: null,
        phase: "checking"
      });

      try {
        const bytes = await readBoundedUpdateResponse(this.options.manifestUrl, {
          allowedHosts: this.options.allowedHosts,
          fetch: this.options.fetch,
          inactivityTimeoutMs: this.options.manifestInactivityTimeoutMs,
          maxBytes: this.options.maxManifestBytes ?? DEFAULT_UPDATE_MANIFEST_MAX_BYTES,
          signal,
          timeoutMs: this.options.requestTimeoutMs
        });
        const manifest = parseUpdateManifestJson(decodeManifest(bytes));

        if (manifest.channel !== this.options.channel) {
          throw new UpdateError(
            "invalid_manifest",
            `Expected ${this.options.channel} update channel, received ${manifest.channel}.`
          );
        }

        const selectedArtifact = selectUpdateArtifact(
          manifest,
          "win32",
          this.options.architecture
        );
        const maxArtifactBytes = this.options.maxArtifactBytes ?? DEFAULT_UPDATE_ARTIFACT_MAX_BYTES;

        if (selectedArtifact.sizeBytes > maxArtifactBytes) {
          throw new UpdateError("artifact_size_mismatch", "Update artifact exceeds the configured size limit.");
        }

        assertAllowedUpdateUrl(selectedArtifact.url, this.options.allowedHosts);

        const versionComparison = compareUpdateVersions(manifest.version, this.options.currentVersion);

        if (versionComparison < 0) {
          throw new UpdateError("invalid_manifest", "Update manifest would downgrade DeskCue.");
        }

        const available = versionComparison > 0;

        await this.writeState(available
          ? {
              ...previous,
              artifact: selectedArtifact,
              error: null,
              phase: "available",
              progressBytes: 0,
              stagedPath: null,
              targetVersion: manifest.version,
              totalBytes: selectedArtifact.sizeBytes
            }
          : {
              ...previous,
              artifact: null,
              error: null,
              phase: "idle",
              progressBytes: 0,
              stagedPath: null,
              targetVersion: null,
              totalBytes: 0
            });

        return {
          available,
          currentVersion: this.options.currentVersion,
          manifest,
          selectedArtifact
        };
      } catch (error) {
        if (error instanceof UpdateError && error.code === "cancelled") {
          await this.writeState({
            ...previous,
            error: null
          });
        } else {
          await this.persistOperationError(previous, error);
        }

        throw error;
      }
    });
  }

  downloadAvailableUpdate(
    onProgress?: (progress: UpdateDownloadProgress) => void
  ): Promise<UpdateState> {
    return this.runSingleFlight("download", async (signal) => {
      const available = await this.readState();

      if (available.phase !== "available" || !available.artifact || !available.targetVersion) {
        throw new UpdateError("update_not_available", "No checked update is available for download.");
      }

      await this.writeState({
        ...available,
        error: null,
        phase: "downloading",
        progressBytes: 0
      });

      try {
        await mkdir(this.options.stageDirectory, { recursive: true });
        const destinationPath = join(
          this.options.stageDirectory,
          stagedInstallerName(
            available.targetVersion,
            this.options.architecture
          )
        );

        await cleanupUpdateStageArtifacts({
          preserveInstallerPaths: [destinationPath],
          stageDirectory: this.options.stageDirectory
        });

        if (await reuseExistingStagedArtifact(destinationPath, available.artifact)) {
          const reused: UpdateState = {
            ...available,
            error: null,
            phase: "staged",
            progressBytes: available.artifact.sizeBytes,
            stagedPath: destinationPath
          };

          onProgress?.({
            receivedBytes: available.artifact.sizeBytes,
            totalBytes: available.artifact.sizeBytes
          });

          await this.writeState(reused);

          return reused;
        }

        await downloadUpdateArtifact({
          allowedHosts: this.options.allowedHosts,
          artifact: available.artifact,
          destinationPath,
          fetch: this.options.fetch,
          inactivityTimeoutMs: this.options.artifactInactivityTimeoutMs,
          maxBytes: this.options.maxArtifactBytes ?? DEFAULT_UPDATE_ARTIFACT_MAX_BYTES,
          onProgress,
          signal,
          timeoutMs: this.options.requestTimeoutMs
        });

        const staged: UpdateState = {
          ...available,
          error: null,
          phase: "staged",
          progressBytes: available.artifact.sizeBytes,
          stagedPath: destinationPath
        };

        await this.writeState(staged);

        return staged;
      } catch (error) {
        if (error instanceof UpdateError && error.code === "cancelled") {
          await this.writeState({
            ...available,
            error: null,
            phase: "available",
            progressBytes: 0
          });
        } else {
          await this.persistOperationError(available, error);
        }

        throw error;
      }
    });
  }

  cancelActiveOperation() {
    if (!this.activeOperation) return false;

    this.activeOperation.controller.abort(new Error("Update operation cancelled."));
    return true;
  }

  async prepareApply(
    arguments_: readonly string[] = WINDOWS_INNO_UPDATE_ARGUMENTS
  ): Promise<InstallerApplyHandoff> {
    if (this.activeOperation) {
      throw new UpdateError("operation_in_progress", "Another update operation is already in progress.");
    }

    const staged = await this.readState();

    if (staged.phase !== "staged" || !staged.artifact || !staged.stagedPath || !staged.targetVersion) {
      throw new UpdateError("missing_staged_artifact", "No verified update installer is staged.");
    }

    const handoff = await prepareInstallerApplyHandoff({
      arguments: arguments_,
      artifact: staged.artifact,
      currentVersion: this.options.currentVersion,
      installerPath: staged.stagedPath,
      targetVersion: staged.targetVersion
    });

    await this.writeState({
      ...staged,
      error: null,
      phase: "applying"
    });

    return handoff;
  }

  async recordApplyLaunchFailure(error: unknown) {
    const applying = await this.readState();

    if (applying.phase !== "applying") return applying;

    const updateError = toUpdateError(error, "installer_launch_failed");
    const staged: UpdateState = {
      ...applying,
      error: {
        code: updateError.code,
        message: updateError.message
      },
      phase: "staged",
      updatedAt: this.now().toISOString()
    };

    await this.options.stateStore.write(staged);

    return staged;
  }

  private async cleanupStageArtifacts(state: UpdateState) {
    await cleanupUpdateStageArtifacts({
      preserveInstallerPaths: preservedStageInstallerPaths(
        state,
        this.options.stageDirectory,
        this.options.architecture
      ),
      stageDirectory: this.options.stageDirectory
    });
  }

  private async persistOperationError(previous: UpdateState, error: unknown) {
    const updateError = toUpdateError(error, "download_failed");

    await this.options.stateStore.write(withUpdateFailure(previous, updateError, this.now()));
  }

  private runSingleFlight<T>(kind: ActiveOperation["kind"], operation: (signal: AbortSignal) => Promise<T>) {
    if (this.activeOperation) {
      if (this.activeOperation.kind === kind) return this.activeOperation.promise as Promise<T>;

      return Promise.reject(new UpdateError(
        "operation_in_progress",
        `Cannot start update ${kind} while ${this.activeOperation.kind} is in progress.`
      ));
    }

    const controller = new AbortController();
    const promise = operation(controller.signal).finally(() => {
      if (this.activeOperation?.promise === promise) this.activeOperation = null;
    });

    this.activeOperation = {
      controller,
      kind,
      promise
    };

    return promise;
  }

  private writeState(state: UpdateState) {
    return this.options.stateStore.write({
      ...state,
      architecture: this.options.architecture,
      channel: this.options.channel,
      currentVersion: this.options.currentVersion,
      updatedAt: this.now().toISOString()
    });
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }
}
