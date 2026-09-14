import { join } from "node:path";

import {
  resolveDeskCueDataRoot,
  resolveHostControlPaths
} from "@deskcue/host-control";

function readOptionalEnv(name: string) {
  const value = process.env[name]?.trim();

  return value ? value : null;
}

export function isPackagedCli() {
  return readOptionalEnv("DESKCUE_DISTRIBUTION_MODE") === "installed";
}

export function resolveCliDataRoot() {
  return resolveDeskCueDataRoot();
}

export function resolveCliDataPaths() {
  const dataRoot = resolveCliDataRoot();
  const serviceDataDir = resolveHostControlPaths(dataRoot).serviceDataPath;
  const logDir = readOptionalEnv("DESKCUE_LOG_DIR");

  return {
    dataRoot,
    databaseFile: readOptionalEnv("DESKCUE_DATABASE_FILE") ?? join(serviceDataDir, "deskcue.sqlite"),
    logFile: readOptionalEnv("DESKCUE_LOG_FILE") ?? (
      logDir ? join(logDir, "daemon.jsonl") : join(serviceDataDir, "logs", "daemon.jsonl")
    )
  };
}
