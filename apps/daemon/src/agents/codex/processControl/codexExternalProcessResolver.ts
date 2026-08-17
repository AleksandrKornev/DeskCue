import { win32 } from "node:path";

import {
  findUniqueExternalProcess,
  validateExternalProcessIdentity
} from "#infrastructure/process/externalProcessIdentity";
import type {
  ExternalProcessIdentity,
  ExternalProcessSnapshot
} from "#infrastructure/process/externalProcessIdentity";
import type { ExternalProcessInventory } from "#infrastructure/process/externalProcessInventory";

export type CodexExternalProcessConfidence =
  | "none"
  | "exact_thread_id_in_argv"
  | "validated";

export type CodexExternalProcessResolution =
  | {
      confidence: "none";
      reason: "no_exact_thread_process" | "ambiguous_exact_thread_process";
      process: null;
    }
  | {
      confidence: "exact_thread_id_in_argv";
      reason: null;
      process: ExternalProcessIdentity;
    };

export type CodexExternalProcessValidation =
  | {
      confidence: "validated";
      reason: null;
      process: ExternalProcessIdentity;
    }
  | {
      confidence: "none";
      reason:
        | "process_not_found"
        | "process_identity_changed"
        | "command_no_longer_matches_thread"
        | "parent_chain_changed";
      process: null;
    };

function isExactCodexResume(argv: readonly string[], threadId: string | null) {
  if (!threadId) return false;

  return argv.some(
    (argument, index) => argument.toLowerCase() === "resume" && argv[index + 1]?.toLowerCase() === threadId
  );
}

function isCodexExecutable(executablePath: string) {
  const name = win32.basename(executablePath).toLowerCase();
  return name === "codex.exe" || name === "codex";
}

function normalizeThreadId(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

function matchesCodexResumeProcess(process: ExternalProcessIdentity, threadId: string | null) {
  return isCodexExecutable(process.executablePath) && isExactCodexResume(process.argv, threadId);
}

function noResolution(
  reason: "no_exact_thread_process" | "ambiguous_exact_thread_process"
): CodexExternalProcessResolution {
  return { confidence: "none", reason, process: null };
}

function invalid(
  reason: Exclude<CodexExternalProcessValidation["reason"], null>
): CodexExternalProcessValidation {
  return { confidence: "none", reason, process: null };
}

/**
 * Finds only an external Codex process whose argv explicitly resumes this source thread.
 * It never uses workspace, file mtime, process name alone, or timing as evidence.
 */
export function resolveCodexExternalProcess(
  threadId: string,
  processes: readonly ExternalProcessSnapshot[]
): CodexExternalProcessResolution {
  const normalizedThreadId = normalizeThreadId(threadId);
  if (!normalizedThreadId) return noResolution("no_exact_thread_process");

  const resolution = findUniqueExternalProcess(
    processes,
    (process) => matchesCodexResumeProcess(process, normalizedThreadId)
  );
  if (resolution.kind === "found") {
    return {
      confidence: "exact_thread_id_in_argv",
      reason: null,
      process: resolution.process
    };
  }

  return noResolution(
    resolution.kind === "not_found"
      ? "no_exact_thread_process"
      : "ambiguous_exact_thread_process"
  );
}

export async function resolveCodexExternalProcessFromInventory(
  threadId: string,
  inventory: ExternalProcessInventory
) {
  return resolveCodexExternalProcess(threadId, await inventory.listProcesses());
}

/** Rechecks every identity field immediately before a future destructive action. */
export function validateCodexExternalProcess(
  threadId: string,
  expected: ExternalProcessIdentity,
  processes: readonly ExternalProcessSnapshot[]
): CodexExternalProcessValidation {
  const normalizedThreadId = normalizeThreadId(threadId);
  const validation = validateExternalProcessIdentity(
    expected,
    processes,
    (process) => matchesCodexResumeProcess(process, normalizedThreadId)
  );
  if (validation.kind === "validated") return { confidence: "validated", reason: null, process: validation.process };

  return invalid(
    validation.reason === "command_no_longer_matches"
      ? "command_no_longer_matches_thread"
      : validation.reason
  );
}

export async function validateCodexExternalProcessFromInventory(
  threadId: string,
  expected: ExternalProcessIdentity,
  inventory: ExternalProcessInventory
) {
  return validateCodexExternalProcess(threadId, expected, await inventory.listProcesses());
}
