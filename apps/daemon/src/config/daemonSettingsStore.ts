import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";

import { normalizeStoredDaemonSettings } from "./daemonSettings.ts";
import type { StoredDaemonSettings } from "./daemonSettings.ts";

export function readStoredDaemonSettings(filePath: string): StoredDaemonSettings {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return normalizeStoredDaemonSettings(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return {};
  }
}

export function writeStoredDaemonSettings(filePath: string, settings: StoredDaemonSettings) {
  mkdirSync(dirname(filePath), {
    recursive: true
  });

  writeFileSync(
    filePath,
    `${JSON.stringify(normalizeStoredDaemonSettings(settings), null, 2)}\n`,
    "utf8"
  );
}

export function removeStoredDaemonSettings(filePath: string) {
  rmSync(filePath, {
    force: true
  });
}
