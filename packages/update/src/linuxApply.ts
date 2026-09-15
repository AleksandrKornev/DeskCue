import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { UpdateError } from "./errors.ts";
import type { InstallerApplyHandoff } from "./apply.ts";
import { verifyStagedUpdateArtifact } from "./apply.ts";

export type LaunchLinuxApplyOptions = {
  hostPid?: number;
  installRootPath: string;
  platform?: NodeJS.Platform;
  runTransientUnit?: (unitName: string, executablePath: string, arguments_: string[]) => Promise<void>;
  unitPath?: string;
};

const execFileAsync = promisify(execFile);

function linuxApplyLaunchError(error: unknown) {
  if (error instanceof UpdateError) return error;

  return new UpdateError("installer_launch_failed", "Failed to launch the Linux update worker.", {
    cause: error
  });
}

async function runTransientUnit(unitName: string, executablePath: string, arguments_: string[]) {
  await execFileAsync("systemd-run", [
    "--user",
    `--unit=${unitName}`,
    "--collect",
    "--property=Type=exec",
    "--",
    executablePath,
    ...arguments_
  ], { encoding: "utf8" });
}

function resolveUserUnitPath(configuredPath?: string) {
  if (configuredPath) return configuredPath;

  const configRoot = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");

  return join(configRoot, "systemd", "user", "deskcue-host.service");
}

export async function launchLinuxArchiveApplyHandoff(
  handoff: InstallerApplyHandoff,
  options: LaunchLinuxApplyOptions
): Promise<{ pid: number | null; targetVersion: string }> {
  if ((options.platform ?? process.platform) !== "linux") {
    throw new UpdateError("installer_launch_failed", "The Linux update worker can run only on Linux.");
  }

  if (!isAbsolute(options.installRootPath)) {
    throw new UpdateError("installer_launch_failed", "The DeskCue program directory must be absolute.");
  }

  const installRootPath = resolve(options.installRootPath);
  const unitPath = resolveUserUnitPath(options.unitPath);

  if (!isAbsolute(unitPath)) {
    throw new UpdateError("installer_launch_failed", "The DeskCue user-service path must be absolute.");
  }

  if (!existsSync(join(installRootPath, "payload-manifest.json"))) {
    throw new UpdateError("installer_launch_failed", "The installed DeskCue program directory is missing.");
  }

  if (handoff.artifact.platform !== "linux") {
    throw new UpdateError("installer_launch_failed", "The staged artifact does not target Linux.");
  }

  await verifyStagedUpdateArtifact(handoff.installerPath, handoff.artifact);

  const workerPath = fileURLToPath(new URL("./linuxApplyWorker.js", import.meta.url));
  const workerArguments = [
    workerPath,
    "--artifact", handoff.installerPath,
    "--architecture", handoff.artifact.architecture,
    "--install-root", installRootPath,
    "--host-pid", String(options.hostPid ?? process.pid),
    "--sha256", handoff.artifact.sha256,
    "--size", String(handoff.artifact.sizeBytes),
    "--target-version", handoff.targetVersion,
    "--unit-path", resolve(unitPath)
  ];
  const unitName = `deskcue-update-${randomUUID()}.service`;

  try {
    await (options.runTransientUnit ?? runTransientUnit)(unitName, process.execPath, workerArguments);
  } catch (error) {
    throw linuxApplyLaunchError(error);
  }

  return { pid: null, targetVersion: handoff.targetVersion };
}
