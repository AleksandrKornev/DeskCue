import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, openSync, readFileSync, writeFileSync, closeSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type HostControlPaths = {
  controlTokenFilePath: string;
  dataRootPath: string;
  runtimeFilePath: string;
  serviceDataPath: string;
  stateFilePath: string;
};

export type HostLaunchSpec = {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  file: string;
};

type DataRootOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  moduleUrl?: string;
  platform?: NodeJS.Platform;
};

function readOptionalEnv(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();

  return value ? value : null;
}

export function resolveDeskCueDataRoot(options: DataRootOptions = {}) {
  const env = options.env ?? process.env;
  const explicitPath = readOptionalEnv(env, "DESKCUE_DATA_DIR");

  if (explicitPath) return resolve(explicitPath);

  const distributionMode = readOptionalEnv(env, "DESKCUE_DISTRIBUTION_MODE");

  if (distributionMode === "installed") {
    const localAppData = readOptionalEnv(env, "LOCALAPPDATA") ??
      join(options.homeDir ?? os.homedir(), "AppData", "Local");

    return resolve(localAppData, "DeskCue", "data");
  }

  if (options.cwd) return resolve(options.cwd, ".deskcue-data");

  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const workspaceRoot = fileURLToPath(new URL("../../../", moduleUrl));

  return resolve(workspaceRoot, ".deskcue-data");
}

export function resolveHostControlPaths(dataRootPath = resolveDeskCueDataRoot()): HostControlPaths {
  const resolvedDataRootPath = resolve(dataRootPath);
  const serviceDataPath = join(resolvedDataRootPath, "service");

  return {
    controlTokenFilePath: join(serviceDataPath, "host-control-token"),
    dataRootPath: resolvedDataRootPath,
    runtimeFilePath: join(serviceDataPath, "host-runtime.json"),
    serviceDataPath,
    stateFilePath: join(serviceDataPath, "host-state.json")
  };
}

export function readHostControlToken(filePath: string) {
  const token = readFileSync(filePath, "utf8").trim();

  if (token.length < 32 || token.length > 256) {
    throw new Error("DeskCue host control token is invalid.");
  }

  return token;
}

export function readOrCreateHostControlToken(filePath: string) {
  try {
    return readHostControlToken(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  mkdirSync(dirname(filePath), { recursive: true });
  const token = randomBytes(32).toString("base64url");
  let descriptor: number | null = null;

  try {
    descriptor = openSync(filePath, "wx", 0o600);
    writeFileSync(descriptor, `${token}\n`, "utf8");
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return readHostControlToken(filePath);

    throw error;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

export function resolveHostControlEndpoint(_token: string, paths = resolveHostControlPaths()) {
  const endpointScope = process.platform === "win32"
    ? resolve(paths.serviceDataPath).replaceAll("\\", "/").toLowerCase()
    : resolve(paths.serviceDataPath);
  const endpointId = createHash("sha256").update(endpointScope, "utf8").digest("hex").slice(0, 24);

  return process.platform === "win32"
    ? `\\\\.\\pipe\\deskcue-host-${endpointId}`
    : join(paths.serviceDataPath, `host-${endpointId}.sock`);
}

export function resolveHostLaunchSpec(options: {
  env?: NodeJS.ProcessEnv;
  moduleUrl?: string;
} = {}): HostLaunchSpec {
  const env = options.env ?? process.env;
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const defaultEntryPath = fileURLToPath(new URL("../../../apps/host/dist/index.js", moduleUrl));
  const entryPath = readOptionalEnv(env, "DESKCUE_HOST_ENTRY") ?? defaultEntryPath;
  const file = readOptionalEnv(env, "DESKCUE_NODE_EXECUTABLE") ?? process.execPath;

  return {
    args: [entryPath, "--background"],
    cwd: resolve(dirname(entryPath), "../../.."),
    env: { ...env },
    file
  };
}
