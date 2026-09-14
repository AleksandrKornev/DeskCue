import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type PersistedHostState = {
  desiredDaemonRunning: boolean;
};

const DEFAULT_HOST_STATE: PersistedHostState = {
  desiredDaemonRunning: true
};

export function readPersistedHostState(filePath: string): PersistedHostState {
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;

    return {
      desiredDaemonRunning: value.desiredDaemonRunning !== false
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_HOST_STATE };

    throw error;
  }
}

export function writePersistedHostState(filePath: string, state: PersistedHostState) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });

  renameSync(temporaryPath, filePath);
}
