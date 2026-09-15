import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { UpdateArchitecture } from "./manifest.ts";

const HOST_EXIT_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_CONFIRMATION_COUNT = 3;
const POLL_INTERVAL_MS = 250;
const execFileAsync = promisify(execFile);

export type LinuxApplyWorkerOptions = {
  architecture: UpdateArchitecture;
  artifactPath: string;
  hostPid: number;
  installRootPath: string;
  sha256: string;
  sizeBytes: number;
  targetVersion: string;
  unitPath: string;
};

export type LinuxApplyWorkerDependencies = {
  extractArtifact?: (options: LinuxApplyWorkerOptions, extractionRoot: string) => Promise<void>;
  runSystemctl?: (...arguments_: string[]) => Promise<void>;
  replaceUserUnit?: (sourcePath: string, targetPath: string, temporaryPath: string) => Promise<void>;
  verifyArtifact?: (options: LinuxApplyWorkerOptions) => Promise<void>;
  waitForHealthyInstall?: (installRootPath: string, expectedVersion?: string) => Promise<void>;
  waitForHostExit?: (pid: number) => Promise<void>;
};

type PayloadManifest = {
  appVersion: string;
  architecture: UpdateArchitecture;
  files: Array<{ path: string; sha256: string; size: number }>;
  packageId: "io.deskcue.app";
  platform: "linux";
  schemaVersion: 1;
};

function delay(durationMs: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

function readArgument(args: string[], name: string) {
  const index = args.indexOf(name);

  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}.`);

  return args[index + 1]!;
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);

  return parsed;
}

function parseOptions(args: string[]): LinuxApplyWorkerOptions {
  const architecture = readArgument(args, "--architecture");
  const artifactArgument = readArgument(args, "--artifact");
  const installRootArgument = readArgument(args, "--install-root");
  const sha256 = readArgument(args, "--sha256");
  const targetVersion = readArgument(args, "--target-version");
  const unitArgument = readArgument(args, "--unit-path");

  if (architecture !== "x64" && architecture !== "arm64") throw new Error("Unsupported architecture.");

  if (!isAbsolute(artifactArgument) || !isAbsolute(installRootArgument) || !isAbsolute(unitArgument)) {
    throw new Error("Update paths must be absolute.");
  }

  if (basename(unitArgument) !== "deskcue-host.service") throw new Error("Invalid DeskCue user-service path.");
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error("Invalid update checksum.");

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(targetVersion)) {
    throw new Error("Invalid target version.");
  }

  return {
    architecture,
    artifactPath: resolve(artifactArgument),
    hostPid: parsePositiveInteger(readArgument(args, "--host-pid"), "Host PID"),
    installRootPath: resolve(installRootArgument),
    sha256,
    sizeBytes: parsePositiveInteger(readArgument(args, "--size"), "Artifact size"),
    targetVersion,
    unitPath: resolve(unitArgument)
  };
}

function isWithin(parentPath: string, candidatePath: string) {
  const candidateRelativePath = relative(resolve(parentPath), resolve(candidatePath));

  return candidateRelativePath === "" || (
    candidateRelativePath !== ".." &&
    !candidateRelativePath.startsWith(`..${sep}`) &&
    !isAbsolute(candidateRelativePath)
  );
}

function validateManifestPath(value: string) {
  if (!value || value.includes("\\") || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error(`Unsafe payload manifest path: ${value}`);
  }

  return value;
}

function parsePayloadManifest(value: unknown, options: LinuxApplyWorkerOptions): PayloadManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid payload manifest.");

  const manifest = value as Record<string, unknown>;

  if (
    manifest.schemaVersion !== 1 ||
    manifest.packageId !== "io.deskcue.app" ||
    manifest.platform !== "linux"
  ) throw new Error("Unsupported payload manifest.");

  if (manifest.architecture !== options.architecture || manifest.appVersion !== options.targetVersion) {
    throw new Error("Payload target does not match the requested update.");
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("Payload file list is empty.");

  return manifest as PayloadManifest;
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) hash.update(chunk);

  return hash.digest("hex");
}

async function listPayloadFiles(directoryPath: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];

  for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const entryPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) files.push(...await listPayloadFiles(entryPath, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`Linux payload cannot contain links or special files: ${relativePath}`);
  }

  return files;
}

async function verifyArtifact(options: LinuxApplyWorkerOptions) {
  const artifactStats = await stat(options.artifactPath);

  if (!artifactStats.isFile() || artifactStats.size !== options.sizeBytes) throw new Error("Update artifact size changed.");
  if (await sha256File(options.artifactPath) !== options.sha256) throw new Error("Update artifact checksum changed.");
}

async function verifyInstallRoot(installRootPath: string) {
  if (!isAbsolute(installRootPath) || dirname(installRootPath) === installRootPath) {
    throw new Error("Unsafe DeskCue install root.");
  }

  const rootStats = await lstat(installRootPath);

  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("DeskCue install root is not a recognized package.");
  }

  const markerStats = await lstat(join(installRootPath, "payload-manifest.json"));
  const ownerStats = await lstat(join(installRootPath, "installation-owner.json"));

  if (
    !markerStats.isFile() ||
    markerStats.isSymbolicLink() ||
    !ownerStats.isFile() ||
    ownerStats.isSymbolicLink()
  ) {
    throw new Error("DeskCue install root is not a recognized package.");
  }

  const manifest = JSON.parse(await readFile(join(installRootPath, "payload-manifest.json"), "utf8"));
  const owner = JSON.parse(await readFile(join(installRootPath, "installation-owner.json"), "utf8"));
  const requiredFiles = ["bin/deskcue", "installation-owner.json", "systemd/deskcue-host.service"];
  const manifestPaths = new Set(
    Array.isArray(manifest?.files)
      ? manifest.files.map((entry: { path?: unknown }) => entry?.path)
      : []
  );

  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.packageId !== "io.deskcue.app" ||
    manifest?.platform !== "linux" ||
    owner?.schemaVersion !== 1 ||
    owner?.packageId !== "io.deskcue.app" ||
    owner?.updateMode !== "linux-standalone" ||
    requiredFiles.some((relativePath) => !manifestPaths.has(relativePath))
  ) throw new Error("DeskCue install root is not a recognized package.");

  for (const relativePath of requiredFiles) {
    const requiredStats = await lstat(join(installRootPath, ...relativePath.split("/")));

    if (!requiredStats.isFile() || requiredStats.isSymbolicLink()) {
      throw new Error("DeskCue install root is not a recognized package.");
    }
  }
}

async function verifyUserUnitOwnership(installRootPath: string, unitPath: string) {
  const unitStats = await lstat(unitPath);

  if (!unitStats.isFile() || unitStats.isSymbolicLink()) {
    throw new Error("DeskCue user service is not an owned regular file.");
  }

  const [installedUnit, activeUnit] = await Promise.all([
    readFile(join(installRootPath, "systemd", "deskcue-host.service")),
    readFile(unitPath)
  ]);

  if (!installedUnit.equals(activeUnit)) throw new Error("DeskCue user service was modified outside the package.");
}

export async function verifyExtractedLinuxPayload(
  payloadRoot: string,
  options: LinuxApplyWorkerOptions
) {
  const manifestPath = join(payloadRoot, "payload-manifest.json");
  const manifest = parsePayloadManifest(JSON.parse(await readFile(manifestPath, "utf8")), options);
  const seen = new Set<string>();

  for (const entry of manifest.files) {
    if (!entry || typeof entry !== "object") throw new Error("Invalid payload file entry.");

    const relativePath = validateManifestPath(entry.path);
    const filePath = resolve(payloadRoot, ...relativePath.split("/"));

    if (!isWithin(payloadRoot, filePath) || seen.has(relativePath)) throw new Error("Invalid payload file identity.");

    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
      throw new Error(`Invalid payload metadata for ${relativePath}.`);
    }

    const fileStats = await lstat(filePath);

    if (!fileStats.isFile() || fileStats.isSymbolicLink() || fileStats.size !== entry.size) {
      throw new Error(`Payload file differs from its manifest: ${relativePath}.`);
    }

    if (await sha256File(filePath) !== entry.sha256) {
      throw new Error(`Payload checksum differs from its manifest: ${relativePath}.`);
    }

    seen.add(relativePath);
  }

  const actualFiles = (await listPayloadFiles(payloadRoot))
    .filter((relativePath) => relativePath !== "payload-manifest.json")
    .sort();
  const declaredFiles = [...seen].sort();

  if (
    actualFiles.length !== declaredFiles.length ||
    actualFiles.some((relativePath, index) => relativePath !== declaredFiles[index])
  ) {
    throw new Error("Payload files differ from the payload manifest.");
  }
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForHostExit(pid: number) {
  const deadline = Date.now() + HOST_EXIT_TIMEOUT_MS;

  while (isProcessRunning(pid)) {
    if (Date.now() >= deadline) throw new Error("DeskCue Host did not exit before the update deadline.");

    await delay(POLL_INTERVAL_MS);
  }
}

async function runSystemctl(...arguments_: string[]) {
  await execFileAsync("systemctl", ["--user", ...arguments_], { timeout: HEALTH_TIMEOUT_MS });
}

async function waitForHealthyInstall(installRootPath: string, expectedVersion?: string) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  const nodePath = join(installRootPath, "runtime", "node");
  const cliPath = join(installRootPath, "app", "apps", "cli", "dist", "index.js");
  let confirmations = 0;

  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync(nodePath, [cliPath, "status", "--json"], {
        env: {
          ...process.env,
          DESKCUE_DISTRIBUTION_MODE: "installed",
          DESKCUE_INSTALL_DIR: installRootPath,
          DESKCUE_UPDATE_APPLY_MODE: "linux-standalone"
        },
        timeout: 5_000
      });
      const status = JSON.parse(stdout).data?.status;

      if (
        expectedVersion &&
        (status?.host?.version !== expectedVersion || status?.daemon?.version !== expectedVersion)
      ) throw new Error("DeskCue reported a different version after update.");

      confirmations += 1;
      if (confirmations >= HEALTH_CONFIRMATION_COUNT) return;
    } catch {
      confirmations = 0;
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error("Updated DeskCue did not become healthy.");
}

async function replaceUserUnit(sourcePath: string, targetPath: string, temporaryPath: string) {
  const sourceStats = await lstat(sourcePath);

  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
    throw new Error("Packaged DeskCue user service is not a regular file.");
  }

  await rm(temporaryPath, { force: true });

  try {
    await writeFile(temporaryPath, await readFile(sourcePath), { flag: "wx", mode: 0o644 });
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function extractArtifact(options: LinuxApplyWorkerOptions, extractionRoot: string) {
  await execFileAsync("tar", ["-xzf", options.artifactPath, "--directory", extractionRoot, "--strip-components=1"], {
    timeout: HEALTH_TIMEOUT_MS
  });

  await verifyExtractedLinuxPayload(extractionRoot, options);
}

async function restoreBackup(
  installRootPath: string,
  backupRoot: string,
  failedRoot: string,
  unitPath: string,
  unitTemporaryPath: string,
  runSystemctlCommand: typeof runSystemctl,
  replaceUnit: typeof replaceUserUnit,
  waitForHealthy: typeof waitForHealthyInstall
) {
  await runSystemctlCommand("stop", "deskcue-host.service").catch(() => undefined);
  if (existsSync(installRootPath)) await rename(installRootPath, failedRoot);
  await rename(backupRoot, installRootPath);
  await replaceUnit(
    join(installRootPath, "systemd", "deskcue-host.service"),
    unitPath,
    unitTemporaryPath
  );

  await runSystemctlCommand("daemon-reload");
  await runSystemctlCommand("restart", "deskcue-host.service");
  await waitForHealthy(installRootPath);
  await rm(failedRoot, { force: true, recursive: true });
}

export async function applyLinuxUpdate(
  options: LinuxApplyWorkerOptions,
  dependencies: LinuxApplyWorkerDependencies = {}
) {
  if (
    !isAbsolute(options.artifactPath) ||
    !isAbsolute(options.unitPath) ||
    basename(options.unitPath) !== "deskcue-host.service"
  ) {
    throw new Error("Update paths must be absolute and owned by DeskCue.");
  }

  await verifyInstallRoot(options.installRootPath);
  await verifyUserUnitOwnership(options.installRootPath, options.unitPath);

  const installParent = dirname(options.installRootPath);
  const installName = basename(options.installRootPath);
  const operationId = randomUUID();
  const backupRoot = join(installParent, `.${installName}-backup-${operationId}`);
  const failedRoot = join(installParent, `.${installName}-failed-${operationId}`);
  const extractionRoot = await mkdtemp(join(installParent, `.${installName}-update-${operationId}-`));
  const unitTemporaryPath = join(dirname(options.unitPath), `.deskcue-host.service.update-${operationId}`);
  const extract = dependencies.extractArtifact ?? extractArtifact;
  const replaceUnit = dependencies.replaceUserUnit ?? replaceUserUnit;
  const runSystemctlCommand = dependencies.runSystemctl ?? runSystemctl;
  const verify = dependencies.verifyArtifact ?? verifyArtifact;
  const waitForHealthy = dependencies.waitForHealthyInstall ?? waitForHealthyInstall;
  const waitForExit = dependencies.waitForHostExit ?? waitForHostExit;
  let replacementStarted = false;

  try {
    await verify(options);
    await extract(options, extractionRoot);
    await waitForExit(options.hostPid);
    await rename(options.installRootPath, backupRoot);
    replacementStarted = true;

    try {
      await rename(extractionRoot, options.installRootPath);
    } catch (error) {
      await rename(backupRoot, options.installRootPath);
      await runSystemctlCommand("restart", "deskcue-host.service");
      throw error;
    }

    try {
      await replaceUnit(
        join(options.installRootPath, "systemd", "deskcue-host.service"),
        options.unitPath,
        unitTemporaryPath
      );

      await runSystemctlCommand("daemon-reload");
      await runSystemctlCommand("restart", "deskcue-host.service");
      await waitForHealthy(options.installRootPath, options.targetVersion);
    } catch (error) {
      try {
        await restoreBackup(
          options.installRootPath,
          backupRoot,
          failedRoot,
          options.unitPath,
          unitTemporaryPath,
          runSystemctlCommand,
          replaceUnit,
          waitForHealthy
        );
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `DeskCue update failed and the restored version is unhealthy; failed payload retained at ${failedRoot}.`
        );
      }

      throw error;
    }

    await rm(backupRoot, { force: true, recursive: true });
    await rm(options.artifactPath, { force: true });
  } catch (error) {
    if (!replacementStarted) {
      await runSystemctlCommand("restart", "deskcue-host.service").catch(() => undefined);
    }

    throw error;
  } finally {
    await rm(extractionRoot, { force: true, recursive: true }).catch(() => undefined);
    await rm(unitTemporaryPath, { force: true }).catch(() => undefined);
  }
}

async function main() {
  if (process.platform !== "linux") throw new Error("The Linux update worker can run only on Linux.");

  await applyLinuxUpdate(parseOptions(process.argv.slice(2)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
