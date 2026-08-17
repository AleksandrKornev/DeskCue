import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { daemonConfig } from "#config/daemonConfig";

const execFileAsync = promisify(execFile);

export async function exists(targetPath: string) {
  if (!targetPath) {
    return false;
  }

  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(daemonConfig.runtimeHttpTimeoutMs)
    });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function commandExists(command: string) {
  try {
    const lookup = process.platform === "win32" ? "where.exe" : "which";
    await execFileAsync(lookup, [command], {
      timeout: daemonConfig.runtimeCommandTimeoutMs,
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

export async function execJsonCommand(command: string, args: string[], timeout: number) {
  const { stdout } = await execFileAsync(command, args, {
    timeout,
    windowsHide: true
  });
  return JSON.parse(stdout) as unknown;
}

export function firstDefinedString(records: Record<string, unknown>[], fields: string[]) {
  for (const record of records) {
    for (const field of fields) {
      const value = record[field];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }

  return null;
}
