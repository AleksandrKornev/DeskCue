import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ExternalProcessSnapshot } from "./externalProcessIdentity.ts";

export interface ExternalProcessInventory {
  listProcesses(): Promise<ExternalProcessSnapshot[]>;
}

const MAX_PROCESS_INVENTORY_BYTES = 8 * 1024 * 1024;
const execFileAsync = promisify(execFile);

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function toPositiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function toNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCreationTime(value: unknown) {
  const raw = toNonEmptyString(value);
  if (!raw) return null;

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString();
}

export function parseWindowsProcessInventory(raw: string): ExternalProcessSnapshot[] {
  const parsed = safeParseJson(raw.trim());
  const entries = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];

  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];

    const processId = toPositiveInteger(entry.ProcessId);
    const createdAt = normalizeCreationTime(entry.CreationDate);
    if (!processId || !createdAt) return [];

    return [{
      processId,
      parentProcessId: toPositiveInteger(entry.ParentProcessId),
      createdAt,
      executablePath: toNonEmptyString(entry.ExecutablePath),
      commandLine: toNonEmptyString(entry.CommandLine)
    }];
  });
}

/** Read-only Windows process inventory. No control command is issued. */
export const windowsExternalProcessInventory: ExternalProcessInventory = {
  async listProcesses() {
    if (process.platform !== "win32") return [];

    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance -ClassName Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
      ],
      {
        windowsHide: true,
        maxBuffer: MAX_PROCESS_INVENTORY_BYTES
      }
    );

    return parseWindowsProcessInventory(stdout);
  }
};
