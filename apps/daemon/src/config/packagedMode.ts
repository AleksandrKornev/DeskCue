import os from "node:os";
import path from "node:path";

const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

type PackagedDataRootOptions = {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
};

function readEnvironmentPath(environment: NodeJS.ProcessEnv, name: string) {
  return environment[name]?.trim() || null;
}

export function isPackagedMode(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.DESKCUE_PACKAGED?.trim().toLowerCase();

  return value ? TRUE_ENV_VALUES.has(value) : false;
}

export function getPackagedDataRootPath({
  environment = process.env,
  homeDirectory = os.homedir(),
  platform = process.platform
}: PackagedDataRootOptions = {}) {
  if (platform === "win32") {
    const localAppData = readEnvironmentPath(environment, "LOCALAPPDATA") ??
      path.win32.join(homeDirectory, "AppData", "Local");

    return path.win32.join(localAppData, "DeskCue", "data");
  }

  if (platform === "darwin") {
    return path.posix.join(homeDirectory, "Library", "Application Support", "DeskCue", "data");
  }

  const localDataHome = readEnvironmentPath(environment, "XDG_DATA_HOME") ??
    path.posix.join(homeDirectory, ".local", "share");

  return path.posix.join(localDataHome, "DeskCue", "data");
}
