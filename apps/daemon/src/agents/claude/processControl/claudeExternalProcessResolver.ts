import { win32 } from "node:path";

import {
  findUniqueExternalProcess,
  validateExternalProcessIdentity
} from "#infrastructure/process/externalProcessIdentity";
import type {
  ExternalProcessIdentity,
  ExternalProcessSnapshot
} from "#infrastructure/process/externalProcessIdentity";

export type ClaudeExternalProcessResolution =
  | {
      confidence: "none";
      reason: "no_exact_session_process" | "ambiguous_exact_session_process";
      process: null;
    }
  | {
      confidence: "exact_session_id_in_argv";
      reason: null;
      process: ExternalProcessIdentity;
    };

export type ClaudeExternalProcessValidation =
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
        | "command_no_longer_matches_session"
        | "parent_chain_changed";
      process: null;
    };

function isExactClaudeSessionProcess(argv: readonly string[], sourceSessionId: string | null) {
  if (!sourceSessionId || argv.includes("--bg-pty-host")) return false;

  return argv.some((argument, index) => (
    (argument === "--resume" || argument === "--session-id") &&
    argv[index + 1]?.toLowerCase() === sourceSessionId
  ));
}

function isClaudeExecutable(executablePath: string) {
  const name = win32.basename(executablePath).toLowerCase();
  return name === "claude.exe" || name === "claude";
}

function normalizeSessionId(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function matchesClaudeSessionProcess(
  process: ExternalProcessIdentity,
  sourceSessionId: string | null
) {
  return isClaudeExecutable(process.executablePath) &&
    isExactClaudeSessionProcess(process.argv, sourceSessionId);
}

function noResolution(
  reason: "no_exact_session_process" | "ambiguous_exact_session_process"
): ClaudeExternalProcessResolution {
  return { confidence: "none", reason, process: null };
}

function invalid(
  reason: Exclude<ClaudeExternalProcessValidation["reason"], null>
): ClaudeExternalProcessValidation {
  return { confidence: "none", reason, process: null };
}

/**
 * Matches only an interactive Claude leaf process explicitly carrying this exact session id.
 * A workspace, process name, or transcript timestamp alone is never sufficient.
 */
export function resolveClaudeExternalProcess(
  sourceSessionId: string,
  processes: readonly ExternalProcessSnapshot[]
): ClaudeExternalProcessResolution {
  const normalizedSessionId = normalizeSessionId(sourceSessionId);
  if (!normalizedSessionId) return noResolution("no_exact_session_process");

  const resolution = findUniqueExternalProcess(
    processes,
    (process) => matchesClaudeSessionProcess(process, normalizedSessionId)
  );
  if (resolution.kind === "found") {
    return {
      confidence: "exact_session_id_in_argv",
      reason: null,
      process: resolution.process
    };
  }

  return noResolution(
    resolution.kind === "not_found"
      ? "no_exact_session_process"
      : "ambiguous_exact_session_process"
  );
}

export function validateClaudeExternalProcess(
  sourceSessionId: string,
  expected: ExternalProcessIdentity,
  processes: readonly ExternalProcessSnapshot[]
): ClaudeExternalProcessValidation {
  const normalizedSessionId = normalizeSessionId(sourceSessionId);
  const validation = validateExternalProcessIdentity(
    expected,
    processes,
    (process) => matchesClaudeSessionProcess(process, normalizedSessionId)
  );
  if (validation.kind === "validated") return { confidence: "validated", reason: null, process: validation.process };

  return invalid(
    validation.reason === "command_no_longer_matches"
      ? "command_no_longer_matches_session"
      : validation.reason
  );
}
