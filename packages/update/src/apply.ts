import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants, createReadStream, existsSync } from "node:fs";
import { chmod, copyFile, lstat, mkdtemp, readFile, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { UpdateError } from "./errors.ts";
import type { UpdateArtifact } from "./manifest.ts";

export const WINDOWS_INNO_UPDATE_ARGUMENTS = [
  "/VERYSILENT",
  "/SUPPRESSMSGBOXES",
  "/NORESTART",
  "/UPDATE",
  "/STARTTRAY=1"
] as const;

export type InstallerApplyHandoff = {
  arguments: string[];
  artifact: UpdateArtifact;
  currentVersion: string;
  installerPath: string;
  targetVersion: string;
};

export type PrepareInstallerApplyHandoffOptions = {
  arguments?: readonly string[];
  artifact: UpdateArtifact;
  currentVersion: string;
  installerPath: string;
  targetVersion: string;
};

export type LaunchInstallerApplyHandoffOptions = {
  spawnInstaller?: typeof spawn;
};

type InstallerApplySnapshot = {
  directoryPath: string;
  installerPath: string;
  markerPath: string;
};

const APPLY_SNAPSHOT_DIRECTORY_PATTERN = /^\.deskcue-apply-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9]{6}$/;
const DURABLE_VERSION_PATTERN_SOURCE = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)" +
  "(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
const DURABLE_INSTALLER_PATTERN = new RegExp(
  `^(?:DeskCueSetup-${DURABLE_VERSION_PATTERN_SOURCE}-win-(?:x64|arm64)\\.exe|` +
  `deskcue-${DURABLE_VERSION_PATTERN_SOURCE}-linux-(?:x64|arm64)\\.tar\\.gz)(?:\\.part)?$`
);
const SNAPSHOT_MARKER_NAME = ".deskcue-update-apply-v1.json";
const installerApplySnapshots = new WeakMap<ReturnType<typeof spawn>, InstallerApplySnapshot>();

export type CleanupUpdateStageArtifactsOptions = {
  preserveInstallerPaths?: readonly string[];
  stageDirectory: string;
};

export type CleanupUpdateStageArtifactsResult = {
  removedInstallerFiles: number;
  removedSnapshotDirectories: number;
};

function installerLaunchError(error: unknown) {
  if (error instanceof UpdateError) return error;

  return new UpdateError("installer_launch_failed", "Failed to launch the staged update installer.", {
    cause: error
  });
}

async function calculateFileSha256(path: string) {
  const hash = createHash("sha256");
  const input = createReadStream(path);

  for await (const chunk of input) hash.update(chunk);

  return hash.digest("hex");
}

async function removeInstallerApplySnapshot(snapshot: InstallerApplySnapshot) {
  await chmod(snapshot.installerPath, 0o600).catch(() => {});

  try {
    await rm(snapshot.installerPath, { force: true });
  } catch {
    return false;
  }

  await rm(snapshot.markerPath, { force: true }).catch(() => {});
  await rmdir(snapshot.directoryPath).catch(() => {});

  return true;
}

function cleanupAfterInstallerExit(this: ReturnType<typeof spawn>) {
  const snapshot = installerApplySnapshots.get(this);

  if (!snapshot) return;

  installerApplySnapshots.delete(this);
  void removeInstallerApplySnapshot(snapshot);
}

export async function verifyStagedUpdateArtifact(
  installerPath: string,
  artifact: UpdateArtifact
) {
  if (!isAbsolute(installerPath) || !existsSync(installerPath)) {
    throw new UpdateError("missing_staged_artifact", "The staged update artifact is missing.");
  }

  const installerStats = await stat(installerPath);

  if (!installerStats.isFile() || installerStats.size !== artifact.sizeBytes) {
    throw new UpdateError("staged_artifact_changed", "The staged update artifact size changed.");
  }

  const sha256 = await calculateFileSha256(installerPath);

  if (sha256 !== artifact.sha256) {
    throw new UpdateError("staged_artifact_changed", "The staged update artifact checksum changed.");
  }

  return {
    path: installerPath,
    sha256,
    sizeBytes: installerStats.size
  };
}

function snapshotMarkerContents(installerName: string, sha256: string) {
  return `${JSON.stringify({ installerName, schemaVersion: 1, sha256 })}\n`;
}

async function readOwnedInstallerApplySnapshot(directoryPath: string) {
  const markerPath = join(directoryPath, SNAPSHOT_MARKER_NAME);
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => null);

  if (!entries || entries.length === 0) {
    return {
      directoryPath,
      installerPath: join(directoryPath, "missing.exe"),
      markerPath
    } satisfies InstallerApplySnapshot;
  }

  const markerEntry = entries.find((entry) => entry.name === SNAPSHOT_MARKER_NAME);
  const installerEntries = entries.filter((entry) => entry.name !== SNAPSHOT_MARKER_NAME);

  if (!markerEntry?.isFile() || installerEntries.length > 1) return null;

  const markerStats = await lstat(markerPath).catch(() => null);

  if (!markerStats?.isFile() || markerStats.size > 512) return null;

  try {
    const parsed = JSON.parse(await readFile(markerPath, "utf8")) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const marker = parsed as Record<string, unknown>;

    if (Object.keys(marker).sort().join(",") !== "installerName,schemaVersion,sha256") return null;
    if (marker.schemaVersion !== 1 || typeof marker.installerName !== "string") return null;
    if (typeof marker.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(marker.sha256)) return null;
    if (basename(marker.installerName) !== marker.installerName || !marker.installerName.endsWith(".exe")) return null;

    if (installerEntries.length === 1) {
      if (!installerEntries[0]?.isFile() || installerEntries[0].name !== marker.installerName) return null;
    }

    return {
      directoryPath,
      installerPath: join(directoryPath, marker.installerName),
      markerPath
    } satisfies InstallerApplySnapshot;
  } catch {
    return null;
  }
}

export async function cleanupUpdateStageArtifacts({
  preserveInstallerPaths = [],
  stageDirectory
}: CleanupUpdateStageArtifactsOptions): Promise<CleanupUpdateStageArtifactsResult> {
  const resolvedStageDirectory = resolve(stageDirectory);
  const preservedPaths = new Set(preserveInstallerPaths.map((path) => resolve(path)));
  const entries = await readdir(resolvedStageDirectory, { withFileTypes: true }).catch(() => null);
  let removedInstallerFiles = 0;
  let removedSnapshotDirectories = 0;

  if (!entries) return { removedInstallerFiles, removedSnapshotDirectories };

  for (const entry of entries) {
    const entryPath = resolve(resolvedStageDirectory, entry.name);

    if (dirname(entryPath) !== resolvedStageDirectory) continue;

    if (entry.isFile() && DURABLE_INSTALLER_PATTERN.test(entry.name)) {
      if (preservedPaths.has(entryPath)) continue;

      try {
        await rm(entryPath, { force: true });
        removedInstallerFiles += 1;
      } catch {
        // A still-running Windows installer can keep its executable locked. A later startup retries cleanup.
      }

      continue;
    }

    if (!entry.isDirectory() || !APPLY_SNAPSHOT_DIRECTORY_PATTERN.test(entry.name)) continue;

    const snapshot = await readOwnedInstallerApplySnapshot(entryPath);

    if (!snapshot) continue;

    if (await removeInstallerApplySnapshot(snapshot)) removedSnapshotDirectories += 1;
  }

  return { removedInstallerFiles, removedSnapshotDirectories };
}

async function createInstallerApplySnapshot(handoff: InstallerApplyHandoff) {
  await verifyStagedUpdateArtifact(handoff.installerPath, handoff.artifact);

  const parentDirectory = dirname(handoff.installerPath);
  const directoryPath = await mkdtemp(join(parentDirectory, `.deskcue-apply-${randomUUID()}-`));
  const snapshot: InstallerApplySnapshot = {
    directoryPath,
    installerPath: join(directoryPath, basename(handoff.installerPath)),
    markerPath: join(directoryPath, SNAPSHOT_MARKER_NAME)
  };

  try {
    await chmod(directoryPath, 0o700);
    await writeFile(
      snapshot.markerPath,
      snapshotMarkerContents(basename(snapshot.installerPath), handoff.artifact.sha256),
      { flag: "wx", flush: true, mode: 0o600 }
    );

    await copyFile(handoff.installerPath, snapshot.installerPath, constants.COPYFILE_EXCL);
    await chmod(snapshot.installerPath, 0o500);
    await verifyStagedUpdateArtifact(snapshot.installerPath, handoff.artifact);

    return snapshot;
  } catch (error) {
    await removeInstallerApplySnapshot(snapshot);
    throw installerLaunchError(error);
  }
}

export async function prepareInstallerApplyHandoff({
  arguments: installerArguments = [],
  artifact,
  currentVersion,
  installerPath,
  targetVersion
}: PrepareInstallerApplyHandoffOptions): Promise<InstallerApplyHandoff> {
  await verifyStagedUpdateArtifact(installerPath, artifact);

  return {
    arguments: [...installerArguments],
    artifact: { ...artifact },
    currentVersion,
    installerPath,
    targetVersion
  };
}

/**
 * Launches a verified, uniquely named private copy rather than the reusable download path.
 * Node's Windows process API still accepts an executable pathname, not an already verified file
 * handle, so a same-user attacker that discovers the private path retains a narrow pathname race
 * between the final checksum and CreateProcess. The snapshot boundary and immediate recheck reduce
 * that residual race but cannot eliminate it without a handle-based Windows launch primitive.
 */
export async function launchInstallerApplyHandoff(
  handoff: InstallerApplyHandoff,
  options: LaunchInstallerApplyHandoffOptions = {}
): Promise<{ pid: number | null; targetVersion: string }> {
  const snapshot = await createInstallerApplySnapshot(handoff);
  const spawnInstaller = options.spawnInstaller ?? spawn;
  let child: ReturnType<typeof spawn>;

  try {
    // Node can only launch a Windows executable by pathname. This checksum is intentionally the
    // final asynchronous operation before spawn, against the exact private snapshot path consumed below.
    await verifyStagedUpdateArtifact(snapshot.installerPath, handoff.artifact);
    child = spawnInstaller(snapshot.installerPath, handoff.arguments, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
  } catch (error) {
    await removeInstallerApplySnapshot(snapshot);
    throw installerLaunchError(error);
  }

  installerApplySnapshots.set(child, snapshot);
  child.once("exit", cleanupAfterInstallerExit);

  try {
    await once(child, "spawn");
  } catch (error) {
    child.off("exit", cleanupAfterInstallerExit);
    installerApplySnapshots.delete(child);
    await removeInstallerApplySnapshot(snapshot);
    throw installerLaunchError(error);
  }

  child.unref();

  return {
    pid: child.pid ?? null,
    targetVersion: handoff.targetVersion
  };
}
