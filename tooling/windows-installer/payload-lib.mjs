import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  copyPayloadTree,
  isWithin,
  normalizeRelativePath,
  readJson
} from "./payload-filesystem.mjs";

export * from "./payload-constants.mjs";
export {
  assertSafeReplaceDirectory,
  copyPayloadTree,
  removeSafePayloadDirectory,
  resetSafePayloadDirectory,
  shouldCopyPayloadPath
} from "./payload-filesystem.mjs";
export {
  createPayloadManifest,
  validatePayloadContents,
  verifyPayloadManifest
} from "./payload-manifest.mjs";
export { runPayloadSmoke } from "./payload-smoke.mjs";

const DESKCUE_RUNTIME_APPS = ["daemon", "cli", "host"];
const DESKCUE_STATIC_APPS = ["web"];

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function copyPackageBuild(sourceRoot, destinationRoot, { includeDist = true } = {}) {
  const packageManifestPath = join(sourceRoot, "package.json");

  copyPayloadTree(packageManifestPath, join(destinationRoot, "package.json"));
  if (includeDist) copyPayloadTree(join(sourceRoot, "dist"), join(destinationRoot, "dist"));
}

function findNpmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  ].filter(Boolean);
  const npmCliPath = candidates.find((candidatePath) => existsSync(candidatePath));

  if (!npmCliPath) {
    throw new Error(
      "Could not locate npm-cli.js. Run the payload builder through npm or an official Node.js distribution."
    );
  }

  return npmCliPath;
}

function readRuntimeWorkspaceNames(repositoryRoot) {
  return DESKCUE_RUNTIME_APPS.map((appName) => join(repositoryRoot, "apps", appName))
    .filter((workspacePath) => existsSync(join(workspacePath, "package.json")))
    .map((workspacePath) => readJson(join(workspacePath, "package.json")).name);
}

function readPackageIdentity(packagePath) {
  const packageManifest = readJson(join(packagePath, "package.json"));

  if (typeof packageManifest.name !== "string" || typeof packageManifest.version !== "string") {
    throw new Error(`Production package has no stable name/version identity: ${packagePath}`);
  }

  return {
    license: typeof packageManifest.license === "string" ? packageManifest.license : null,
    name: packageManifest.name,
    version: packageManifest.version
  };
}

function copyProductionDependencies(repositoryRoot, appRoot) {
  const packagePaths = listProductionPackagePaths(repositoryRoot);
  const packageLock = readJson(join(repositoryRoot, "package-lock.json"));
  const packageNotices = [];
  const copiedDestinations = new Set();

  for (const listedPackagePath of packagePaths) {
    const sourcePath = realpathSync(listedPackagePath);
    const listedRelativePath = normalizeRelativePath(relative(repositoryRoot, listedPackagePath));
    const sourceRelativePath = normalizeRelativePath(relative(repositoryRoot, sourcePath));
    const packageIdentity = readPackageIdentity(sourcePath);
    const lockedPackage = packageLock.packages?.[listedRelativePath];

    if (!lockedPackage) {
      throw new Error(`Production dependency is not recorded in package-lock.json: ${listedRelativePath}`);
    }
    if (!lockedPackage.link && lockedPackage.version !== packageIdentity.version) {
      throw new Error(
        `Production dependency version differs from package-lock.json: ${packageIdentity.name} ` +
        `${packageIdentity.version} (lock: ${lockedPackage.version ?? "missing"})`
      );
    }

    if (packageIdentity.name.startsWith("@deskcue/")) {
      if (sourceRelativePath.startsWith("packages/") && listedRelativePath.startsWith("node_modules/@deskcue/")) {
        const destinationPath = join(appRoot, "node_modules", ...packageIdentity.name.split("/"));

        if (!copiedDestinations.has(destinationPath)) {
          copyPackageBuild(sourcePath, destinationPath);
          copyPackageBuild(sourcePath, join(appRoot, sourceRelativePath));
          copiedDestinations.add(destinationPath);
        }
      }
      continue;
    }

    if (!listedRelativePath.startsWith("node_modules/")) {
      throw new Error(`Production dependency escaped root node_modules: ${listedPackagePath}`);
    }
    if (!isWithin(repositoryRoot, sourcePath)) {
      throw new Error(`Production dependency resolves outside the repository: ${listedPackagePath}`);
    }

    const destinationPath = join(appRoot, ...listedRelativePath.split("/"));

    if (!copiedDestinations.has(destinationPath)) {
      copyPayloadTree(sourcePath, destinationPath);
      copiedDestinations.add(destinationPath);
    }
    packageNotices.push(packageIdentity);
  }

  return packageNotices
    .filter((notice, index, notices) => notices.findIndex(
      (candidate) => candidate.name === notice.name && candidate.version === notice.version
    ) === index)
    .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

function walkTraySourceFiles(directoryPath, prefix = "") {
  const files = [];

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    if (!prefix && (entry.name === "bin" || entry.name === "obj")) continue;

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const entryPath = join(directoryPath, entry.name);
    const entryStats = lstatSync(entryPath);

    if (entryStats.isSymbolicLink()) {
      throw new Error(`Tray sources must not contain symbolic links or junctions: ${relativePath}`);
    }
    if (entryStats.isDirectory()) {
      files.push(...walkTraySourceFiles(entryPath, relativePath));
    } else if (entryStats.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Unsupported tray source input type: ${relativePath}`);
    }
  }

  return files;
}

export function listProductionPackagePaths(repositoryRoot) {
  const workspaceNames = readRuntimeWorkspaceNames(repositoryRoot);
  const npmArguments = [
    findNpmCliPath(),
    "ls",
    "--omit=dev",
    "--all",
    "--parseable",
    ...workspaceNames.flatMap((workspaceName) => ["--workspace", workspaceName])
  ];
  const result = spawnSync(process.execPath, npmArguments, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    throw new Error(`npm could not resolve the production dependency closure:\n${result.stderr || result.stdout}`);
  }

  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && resolve(line) !== resolve(repositoryRoot));
}

export function copyDeskCueBuild(repositoryRoot, payloadRoot) {
  const appRoot = join(payloadRoot, "app");

  for (const appName of DESKCUE_RUNTIME_APPS) {
    const sourceRoot = join(repositoryRoot, "apps", appName);

    if (!existsSync(sourceRoot)) throw new Error(`Required runtime workspace is missing: apps/${appName}`);
    copyPackageBuild(sourceRoot, join(appRoot, "apps", appName));
  }

  for (const appName of DESKCUE_STATIC_APPS) {
    const sourceRoot = join(repositoryRoot, "apps", appName);

    copyPackageBuild(sourceRoot, join(appRoot, "apps", appName));
  }

  const notices = copyProductionDependencies(repositoryRoot, appRoot);

  copyPayloadTree(join(repositoryRoot, "LICENSE"), join(payloadRoot, "LICENSE"));
  writeFileSync(
    join(payloadRoot, "THIRD-PARTY-NOTICES.json"),
    `${JSON.stringify({ packages: notices }, null, 2)}\n`,
    "utf8"
  );
}

export function writeDeskCueCommandShim(payloadRoot) {
  const binDirectory = join(payloadRoot, "bin");

  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(
    join(binDirectory, "deskcue.cmd"),
    [
      "@echo off",
      "setlocal",
      "set \"DESKCUE_DISTRIBUTION_MODE=installed\"",
      "if not defined DESKCUE_DATA_DIR set \"DESKCUE_DATA_DIR=%LOCALAPPDATA%\\DeskCue\\data\"",
      "set \"DESKCUE_HOST_ENTRY=%~dp0..\\app\\apps\\host\\dist\\index.js\"",
      "set \"DESKCUE_NODE_EXECUTABLE=%~dp0..\\runtime\\node.exe\"",
      "\"%~dp0..\\runtime\\node.exe\" \"%~dp0..\\app\\apps\\cli\\dist\\index.js\" %*",
      "exit /b %ERRORLEVEL%",
      ""
    ].join("\r\n"),
    "utf8"
  );
}

export function createTrayBuildIdentity(repositoryRoot, trayExecutablePath) {
  const trayProjectRoot = join(repositoryRoot, "apps", "tray", "DeskCue.Tray");
  const projectFilePath = join(trayProjectRoot, "DeskCue.Tray.csproj");

  if (!existsSync(projectFilePath)) throw new Error(`Tray project is missing: ${projectFilePath}`);

  const executableStats = lstatSync(trayExecutablePath);

  if (!executableStats.isFile() || executableStats.isSymbolicLink()) {
    throw new Error(`Published tray executable must be a real file: ${trayExecutablePath}`);
  }

  const sourceFiles = walkTraySourceFiles(trayProjectRoot)
    .filter((relativePath) => {
      const extension = extname(relativePath).toLowerCase();

      return extension === ".cs" || extension === ".csproj" || relativePath.toLowerCase().startsWith("assets/");
    })
    .sort()
    .map((relativePath) => {
      const filePath = join(trayProjectRoot, ...relativePath.split("/"));
      const fileStats = statSync(filePath);

      return {
        path: `apps/tray/DeskCue.Tray/${relativePath}`,
        sha256: sha256File(filePath),
        size: fileStats.size,
        modifiedTimeMs: Math.trunc(fileStats.mtimeMs)
      };
    });

  if (sourceFiles.length === 0 || !sourceFiles.some((file) => file.path.endsWith("DeskCue.Tray.csproj"))) {
    throw new Error("Tray build identity must include its C# project and source files.");
  }

  const latestSourceModifiedTimeMs = Math.max(...sourceFiles.map((file) => file.modifiedTimeMs));

  if (Math.trunc(executableStats.mtimeMs) < latestSourceModifiedTimeMs) {
    throw new Error(
      `Published tray executable is older than its bound sources: ${trayExecutablePath}. Re-publish the tray.`
    );
  }

  return {
    executableModifiedTimeMs: Math.trunc(executableStats.mtimeMs),
    executableSha256: sha256File(trayExecutablePath),
    executableSize: executableStats.size,
    latestSourceModifiedTimeMs,
    sourceFiles
  };
}

export function copyTrayExecutable(trayExecutablePath, payloadRoot) {
  if (!existsSync(trayExecutablePath) || !statSync(trayExecutablePath).isFile()) {
    throw new Error(`Published tray executable is missing: ${trayExecutablePath}`);
  }

  copyPayloadTree(trayExecutablePath, join(payloadRoot, "DeskCue.Tray.exe"));
}

export function copyDotnetNotices(
  dotnetLicensePath,
  dotnetNoticesPath,
  windowsDesktopLicensePath,
  payloadRoot
) {
  for (const noticePath of [dotnetLicensePath, dotnetNoticesPath, windowsDesktopLicensePath]) {
    if (!noticePath || !existsSync(noticePath) || !statSync(noticePath).isFile()) {
      throw new Error(
        "The self-contained tray requires version-matched .NET LICENSE.txt and ThirdPartyNotices.txt inputs."
      );
    }
  }

  const noticeRoot = join(payloadRoot, "licenses", "dotnet");

  copyPayloadTree(dotnetLicensePath, join(noticeRoot, "NETCore-LICENSE.txt"));
  copyPayloadTree(dotnetNoticesPath, join(noticeRoot, "NETCore-ThirdPartyNotices.txt"));
  copyPayloadTree(windowsDesktopLicensePath, join(noticeRoot, "WindowsDesktop-LICENSE.txt"));
}
