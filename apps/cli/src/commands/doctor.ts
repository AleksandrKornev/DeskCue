import { spawnSync } from "node:child_process";

import {
  listDatabaseBackups,
  readFileStatus,
  readRecentMigrationFailures,
  resolveDataPaths
} from "./doctor/dataInspection.ts";
import type { FileStatus, ToolStatus } from "./doctor/types.ts";

export function printDoctorReport() {
  const paths = resolveDataPaths();
  const database = readFileStatus(paths.databaseFile);
  const logFile = readFileStatus(paths.logFile);
  const { backups, totalCount: backupCount } = listDatabaseBackups(paths.databaseFile);
  const migrationFailures = readRecentMigrationFailures(paths.logFile);
  const git = readGitStatus();

  console.log("DeskCue doctor");
  console.log("");
  console.log("Tools:");
  printToolStatus("git", git);
  console.log("");
  console.log("Data files:");
  printFileStatus("database", database);
  printFileStatus("daemon log", logFile);
  console.log("");
  console.log(`Backups found: ${backupCount}`);
  for (const backup of backups) {
    console.log(`  - ${backup.path} (${formatBytes(backup.sizeBytes)}, ${backup.modifiedAt})`);
  }
  if (backupCount > backups.length) {
    console.log(`  ... ${backupCount - backups.length} more`);
  }
  console.log("");
  console.log(`Recent migration failures: ${migrationFailures.length}`);
  for (const failure of migrationFailures) {
    console.log(`  - ${failure.timestamp ?? "unknown time"} ${failure.message}`);
    if (failure.databaseFile) console.log(`    database: ${failure.databaseFile}`);
    if (failure.backupPath) console.log(`    backup: ${failure.backupPath}`);
    if (failure.detail) console.log(`    detail: ${failure.detail}`);
  }
  console.log("");
  console.log("This command is read-only. It does not restore, delete, or rewrite DeskCue data.");
}

function readGitStatus(): ToolStatus {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });
  return result.status === 0
    ? { available: true, detail: result.stdout.trim() || "available" }
    : { available: false, detail: "not found; workspace branch, changed files and git diff are disabled" };
}

function printFileStatus(label: string, status: FileStatus) {
  if (!status.exists) {
    console.log(`  ${label}: missing (${status.path})`);
    return;
  }
  console.log(`  ${label}: ${status.path} (${formatBytes(status.sizeBytes)}, ${status.modifiedAt})`);
}

function printToolStatus(label: string, status: ToolStatus) {
  console.log(`  ${label}: ${status.detail}`);
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const sizeKiB = sizeBytes / 1024;
  if (sizeKiB < 1024) return `${sizeKiB.toFixed(1)} KiB`;
  return `${(sizeKiB / 1024).toFixed(1)} MiB`;
}
