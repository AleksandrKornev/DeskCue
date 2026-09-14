import { spawnSync } from "node:child_process";

import type { HostStatus } from "@deskcue/host-control";

import {
  listDatabaseBackups,
  readFileStatus,
  readRecentMigrationFailures,
  resolveDataPaths
} from "./doctor/dataInspection.ts";
import type { FileStatus, ToolStatus } from "./doctor/types.ts";
import { sanitizeTerminalLine } from "../output.ts";
import { isPackagedCli } from "../paths.ts";
import { formatUpdateError } from "./update.ts";

export type DoctorCheck = {
  id: string;
  message: string;
  next?: string;
  status: "failed" | "passed" | "warning";
};

export type DoctorHealth = {
  checks: DoctorCheck[];
  summary: {
    failed: number;
    passed: number;
    status: "healthy" | "inactive" | "issues_found" | "warnings";
    warnings: number;
  };
};

const GIT_CHECK_TIMEOUT_MS = 2_000;

function readGitStatus(): ToolStatus {
  const result = spawnSync("git", ["--version"], {
    encoding: "utf8",
    timeout: GIT_CHECK_TIMEOUT_MS,
    windowsHide: true
  });

  if (result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    return { available: false, detail: "timed out; workspace branch, changed files and git diff are disabled" };
  }

  return result.status === 0
    ? { available: true, detail: result.stdout.trim() || "available" }
    : { available: false, detail: "not found; workspace branch, changed files and git diff are disabled" };
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;

  const sizeKiB = sizeBytes / 1024;

  if (sizeKiB < 1024) return `${sizeKiB.toFixed(1)} KiB`;

  return `${(sizeKiB / 1024).toFixed(1)} MiB`;
}

function formatFileStatus(label: string, status: FileStatus) {
  return status.exists
    ? `  ${label}: ${sanitizeTerminalLine(status.path)} ` +
      `(${formatBytes(status.sizeBytes)}, ${sanitizeTerminalLine(status.modifiedAt)})`
    : `  ${label}: missing (${sanitizeTerminalLine(status.path)})`;
}

export function readDoctorReport() {
  const paths = resolveDataPaths();
  const database = readFileStatus(paths.databaseFile);
  const logFile = readFileStatus(paths.logFile);
  const { backups, totalCount: backupCount } = listDatabaseBackups(paths.databaseFile);
  const migrationFailures = readRecentMigrationFailures(paths.logFile);

  return {
    backups,
    backupCount,
    database,
    git: readGitStatus(),
    logFile,
    migrationFailures,
    mode: isPackagedCli() ? "installed" as const : "source" as const
  };
}

function createDoctorCheck(
  id: string,
  status: DoctorCheck["status"],
  message: string,
  next?: string
): DoctorCheck {
  return {
    id,
    message,
    ...(next ? { next } : {}),
    status
  };
}

export function evaluateDoctorHealth({
  cliVersion,
  hostError,
  hostStatus,
  report
}: {
  cliVersion: string;
  hostError: string | null;
  hostStatus: HostStatus | null;
  report: ReturnType<typeof readDoctorReport>;
}): DoctorHealth {
  const checks: DoctorCheck[] = [];

  checks.push(report.git.available
    ? createDoctorCheck("git", "passed", "Git is available.")
    : createDoctorCheck("git", "warning", report.git.detail, "Install Git and restart DeskCue to enable Git features."));

  checks.push(report.database.exists && report.database.sizeBytes > 0
    ? createDoctorCheck("database", "passed", "The DeskCue database exists.")
    : report.database.exists
      ? createDoctorCheck("database", "failed", "The DeskCue database is empty.")
    : createDoctorCheck(
        "database",
        hostStatus?.daemon.state === "running" ? "failed" : "warning",
        "The DeskCue database is missing. DeskCue creates it when the daemon starts."
      ));

  checks.push(report.logFile.exists
    ? createDoctorCheck("daemon_log", "passed", "The daemon log exists.")
    : createDoctorCheck("daemon_log", "warning", "The daemon log has not been created yet."));

  checks.push(report.migrationFailures.length === 0
    ? createDoctorCheck("migrations", "passed", "No recent migration failures were found.")
    : createDoctorCheck(
        "migrations",
        "failed",
        `${report.migrationFailures.length} recent migration failure(s) were found.`,
        "Review the reported backup paths before changing DeskCue data."
      ));

  if (hostError) {
    checks.push(createDoctorCheck("host", "failed", `The DeskCue Host could not be queried: ${hostError}`));
  } else if (!hostStatus) {
    checks.push(createDoctorCheck("host", "warning", "The DeskCue Host is not running.", "Run deskcue start."));
  } else {
    checks.push(hostStatus.host.state === "degraded"
      ? createDoctorCheck("host", "failed", "The DeskCue Host is degraded.", "Run deskcue logs --lines 100.")
      : hostStatus.host.state === "running"
        ? createDoctorCheck("host", "passed", "The DeskCue Host is running.")
        : createDoctorCheck("host", "warning", `The DeskCue Host is ${hostStatus.host.state}.`));

    checks.push(hostStatus.daemon.state === "degraded"
      ? createDoctorCheck("daemon", "failed", "The DeskCue daemon is degraded.", "Run deskcue logs --lines 100.")
      : hostStatus.daemon.state === "running"
        ? createDoctorCheck("daemon", "passed", "The DeskCue daemon is running.")
        : createDoctorCheck(
            "daemon",
            "warning",
            `The DeskCue daemon is ${hostStatus.daemon.state}.`,
            hostStatus.daemon.state === "stopped" ? "Run deskcue start." : "Run deskcue status again shortly."
          ));

    checks.push(cliVersion === hostStatus.host.version
      ? createDoctorCheck("cli_host_versions", "passed", "CLI and Host versions are aligned.")
      : createDoctorCheck(
          "cli_host_versions",
          "failed",
          `Version mismatch: CLI ${cliVersion}, Host ${hostStatus.host.version}.`,
          "Complete or repair the DeskCue installation before changing local data."
        ));

    if (hostStatus.daemon.version !== null) {
      checks.push(cliVersion === hostStatus.daemon.version
        ? createDoctorCheck("daemon_version", "passed", "CLI and daemon versions are aligned.")
        : createDoctorCheck(
            "daemon_version",
            "failed",
            `Version mismatch: CLI ${cliVersion}, daemon ${hostStatus.daemon.version}.`,
            "Complete or repair the DeskCue installation before changing local data."
          ));
    } else if (hostStatus.daemon.state === "running") {
      checks.push(createDoctorCheck("daemon_version", "warning", "The running daemon version is unavailable."));
    }

    if (hostStatus.update.state === "failed") {
      checks.push(createDoctorCheck(
        "update",
        "failed",
        hostStatus.update.lastError
          ? `The last update check failed: ${formatUpdateError(hostStatus.update.lastError)}`
          : "The last update operation failed.",
        "Check the selected release channel and try deskcue update --check again later."
      ));
    }
  }

  const failed = checks.filter((check) => check.status === "failed").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const inactive = !hostStatus || hostStatus.host.state !== "running" || hostStatus.daemon.state !== "running";
  const status = failed > 0
    ? "issues_found"
    : inactive
      ? "inactive"
      : warnings > 0
        ? "warnings"
        : "healthy";

  return {
    checks,
    summary: {
      failed,
      passed: checks.length - failed - warnings,
      status,
      warnings
    }
  };
}

function formatHealthStatus(status: DoctorHealth["summary"]["status"]) {
  return status.replaceAll("_", " ");
}

export function formatDoctorReport(
  report: ReturnType<typeof readDoctorReport>,
  health: DoctorHealth,
  cliVersion: string
) {
  const lines = [
    "DeskCue doctor",
    "",
    `Result: ${formatHealthStatus(health.summary.status)}; ` +
      `failed: ${health.summary.failed}; warnings: ${health.summary.warnings}`,
    `Mode: ${report.mode}`,
    `CLI version: ${cliVersion}`,
    "",
    "Tools:",
    `  git: ${sanitizeTerminalLine(report.git.detail)}`,
    "",
    "Data files:",
    formatFileStatus("database", report.database),
    formatFileStatus("daemon log", report.logFile),
    "",
    `Backups found: ${report.backupCount}`
  ];

  for (const backup of report.backups) {
    lines.push(
      `  - ${sanitizeTerminalLine(backup.path)} ` +
      `(${formatBytes(backup.sizeBytes)}, ${sanitizeTerminalLine(backup.modifiedAt)})`
    );
  }

  if (report.backupCount > report.backups.length) {
    lines.push(`  ... ${report.backupCount - report.backups.length} more`);
  }

  lines.push("", `Recent migration failures: ${report.migrationFailures.length}`);
  for (const failure of report.migrationFailures) {
    const timestamp = sanitizeTerminalLine(failure.timestamp ?? "unknown time");

    lines.push(`  - ${timestamp} ${sanitizeTerminalLine(failure.message)}`);
    if (failure.databaseFile) lines.push(`    database: ${sanitizeTerminalLine(failure.databaseFile)}`);
    if (failure.backupPath) lines.push(`    backup: ${sanitizeTerminalLine(failure.backupPath)}`);
    if (failure.detail) lines.push(`    detail: ${sanitizeTerminalLine(failure.detail)}`);
  }

  const attention = health.checks.filter((check) => check.status !== "passed");

  if (attention.length > 0) {
    lines.push("", "Checks requiring attention:");
    for (const check of attention) {
      lines.push(`  - [${check.status}] ${sanitizeTerminalLine(check.message)}`);
      if (check.next) lines.push(`    Next: ${sanitizeTerminalLine(check.next)}`);
    }
  }

  lines.push("", "This command is read-only. It does not restore, delete, or rewrite DeskCue data.");

  return lines.join("\n");
}
