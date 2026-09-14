import assert from "node:assert/strict";
import test from "node:test";

import type { HostStatus } from "@deskcue/host-control";

import { evaluateDoctorHealth } from "../doctor.ts";
import type { readDoctorReport } from "../doctor.ts";

function createReport(): ReturnType<typeof readDoctorReport> {
  return {
    backups: [],
    backupCount: 0,
    database: {
      exists: true,
      modifiedAt: "2026-09-14T00:00:00.000Z",
      path: "deskcue.sqlite",
      sizeBytes: 1024
    },
    git: { available: true, detail: "git version 2.43.0" },
    logFile: {
      exists: true,
      modifiedAt: "2026-09-14T00:00:00.000Z",
      path: "daemon.jsonl",
      sizeBytes: 1024
    },
    migrationFailures: [],
    mode: "installed"
  };
}

function createStatus(daemonState: HostStatus["daemon"]["state"]): HostStatus {
  return {
    autostart: { enabled: true, supported: true },
    busyReason: null,
    capabilities: {},
    daemon: {
      baseUrl: daemonState === "running" ? "http://127.0.0.1:4100" : null,
      generation: null,
      lastError: null,
      pid: daemonState === "running" ? 2 : null,
      port: daemonState === "running" ? 4100 : null,
      restartAttempt: 0,
      state: daemonState,
      version: "0.1.1"
    },
    host: {
      pid: 1,
      startedAt: "2026-09-14T00:00:00.000Z",
      state: "running",
      version: "0.1.1"
    },
    update: { availableVersion: null, lastError: null, state: "idle" }
  };
}

test("doctor reports a healthy aligned running installation", () => {
  const health = evaluateDoctorHealth({
    cliVersion: "0.1.1",
    hostError: null,
    hostStatus: createStatus("running"),
    report: createReport()
  });

  assert.deepEqual(health.summary, {
    failed: 0,
    passed: 8,
    status: "healthy",
    warnings: 0
  });
});

test("doctor fails degraded runtime, version skew, update failure and migration failures", () => {
  const report = createReport();
  const status = createStatus("degraded");

  report.migrationFailures.push({
    backupPath: "backup.sqlite",
    databaseFile: "deskcue.sqlite",
    detail: "schema failure",
    message: "SQLite schema migration failed",
    timestamp: "2026-09-14T00:00:00.000Z"
  });
  status.daemon.version = "0.1.0";
  status.update.lastError = "Update source returned HTTP 404.";
  status.update.state = "failed";
  const health = evaluateDoctorHealth({
    cliVersion: "0.1.1",
    hostError: null,
    hostStatus: status,
    report
  });

  assert.equal(health.summary.status, "issues_found");
  assert.equal(health.summary.failed, 4);
  assert.match(
    health.checks.find((check) => check.id === "update")!.message,
    /requested update resource was not found/u
  );
});

test("doctor distinguishes an inactive fresh data root from a healthy installation", () => {
  const report = createReport();

  report.database = { exists: false, path: "deskcue.sqlite" };
  report.logFile = { exists: false, path: "daemon.jsonl" };
  const health = evaluateDoctorHealth({
    cliVersion: "0.1.1",
    hostError: null,
    hostStatus: null,
    report
  });

  assert.equal(health.summary.status, "inactive");
  assert.equal(health.summary.failed, 0);
  assert.equal(health.summary.warnings, 3);
});

test("doctor reports CLI and Host skew while the daemon is stopped", () => {
  const status = createStatus("stopped");

  status.host.version = "0.1.0";
  status.daemon.version = null;
  const health = evaluateDoctorHealth({
    cliVersion: "0.1.1",
    hostError: null,
    hostStatus: status,
    report: createReport()
  });

  assert.equal(health.summary.status, "issues_found");
  assert.equal(health.summary.failed, 1);
  assert.match(health.checks.find((check) => check.id === "cli_host_versions")!.message, /CLI 0\.1\.1, Host 0\.1\.0/u);
  assert.equal(health.checks.some((check) => check.id === "daemon_version"), false);
});
