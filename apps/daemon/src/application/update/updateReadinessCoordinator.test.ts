import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  openDeskCueSqliteDatabase,
  SqliteDatabaseContext
} from "#persistence/connection/sqliteConnection";

import { UpdateAdmission } from "./updateAdmission.ts";
import { UpdateReadinessCoordinator } from "./updateReadinessCoordinator.ts";

function createProbes(overrides: Partial<ConstructorParameters<typeof UpdateReadinessCoordinator>[1]> = {}) {
  return {
    countActiveLocalLlmGenerations: () => 0,
    countActiveLmStudioOperations: () => 0,
    countActiveManagedSessions: () => 0,
    countActiveManualCommands: () => 0,
    countActiveSourceAgentTurns: async () => 0,
    ...overrides
  };
}

test("blocked update preparation reports every active owner and reopens admission", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deskcue-update-blocked-"));
  const sqliteContext = new SqliteDatabaseContext(path.join(root, "deskcue.sqlite"));
  const admission = new UpdateAdmission();
  let quiesceCalled = false;
  const coordinator = new UpdateReadinessCoordinator(admission, createProbes({
    countActiveLocalLlmGenerations: () => 1,
    countActiveLmStudioOperations: () => 2,
    countActiveManagedSessions: () => 3,
    countActiveManualCommands: () => 4,
    countActiveSourceAgentTurns: async () => 5
  }), sqliteContext);

  try {
    const result = await coordinator.beginUpdateDrain(async () => {
      quiesceCalled = true;
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.blockers.map((item) => [item.code, item.count]), [
      ["managed_session_running", 3],
      ["source_agent_turn_active", 5],
      ["local_llm_generation_active", 1],
      ["manual_command_active", 4],
      ["lm_studio_operation_active", 2]
    ]);
    assert.equal(quiesceCalled, false);
    assert.equal(admission.isDraining(), false);
  } finally {
    sqliteContext.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("quiescence failure releases admission without creating a recovery backup", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deskcue-update-quiesce-failure-"));
  const databaseFilePath = path.join(root, "deskcue.sqlite");
  const sqliteContext = new SqliteDatabaseContext(databaseFilePath);
  const admission = new UpdateAdmission();
  const coordinator = new UpdateReadinessCoordinator(admission, createProbes(), sqliteContext);

  sqliteContext.database.exec("CREATE TABLE update_fixture (value TEXT NOT NULL)");

  try {
    await assert.rejects(
      coordinator.beginUpdateDrain(async () => {
        throw new Error("notification drain failed");
      }),
      /notification drain failed/
    );

    assert.equal(admission.isDraining(), false);
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes(".backup-update-")),
      []
    );
  } finally {
    sqliteContext.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("successful update preparation creates a consistent SQLite backup and holds admission", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deskcue-update-ready-"));
  const databaseFilePath = path.join(root, "deskcue.sqlite");
  const sqliteContext = new SqliteDatabaseContext(databaseFilePath);

  sqliteContext.database.exec("CREATE TABLE update_fixture (value TEXT NOT NULL)");

  sqliteContext.database.prepare("INSERT INTO update_fixture (value) VALUES (?)").run("preserved");
  const previousUpdateBackup = `${databaseFilePath}.backup-update-previous`;
  const olderUpdateBackup = `${databaseFilePath}.backup-update-older`;
  const migrationBackup = `${databaseFilePath}.backup-v0-to-v1-previous`;

  await writeFile(previousUpdateBackup, "previous");
  await writeFile(olderUpdateBackup, "older");
  await writeFile(migrationBackup, "migration");

  const admission = new UpdateAdmission();
  const coordinator = new UpdateReadinessCoordinator(admission, createProbes(), sqliteContext);

  try {
    const result = await coordinator.beginUpdateDrain(async () => {
      sqliteContext.database
        .prepare("INSERT INTO update_fixture (value) VALUES (?)")
        .run("final-write");
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.ok(result.backupPath);
    assert.equal(existsSync(result.backupPath), true);
    assert.equal(existsSync(previousUpdateBackup), false);
    assert.equal(existsSync(olderUpdateBackup), false);
    assert.equal(existsSync(migrationBackup), true);
    const backup = openDeskCueSqliteDatabase(result.backupPath);

    try {
      assert.deepEqual(
        backup.prepare("SELECT value FROM update_fixture ORDER BY rowid").all(),
        [{ value: "preserved" }, { value: "final-write" }]
      );
    } finally {
      backup.close();
    }

    assert.equal(admission.isDraining(), true);
    assert.equal(await coordinator.beginUpdateDrain(async () => undefined), result);

    result.release();
    result.release();
    assert.equal(admission.isDraining(), false);

    const nextResult = await coordinator.beginUpdateDrain(async () => undefined);

    assert.equal(nextResult.ok, true);
    if (!nextResult.ok) return;

    assert.notEqual(nextResult.backupPath, result.backupPath);
    assert.equal(existsSync(result.backupPath), false);
    assert.equal(existsSync(nextResult.backupPath!), true);
    assert.equal(existsSync(migrationBackup), true);
    nextResult.release();
  } finally {
    sqliteContext.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("an admitted operation remains a typed blocker across the drain boundary", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deskcue-update-admitted-"));
  const sqliteContext = new SqliteDatabaseContext(path.join(root, "deskcue.sqlite"));
  const admission = new UpdateAdmission();
  let finishOperation!: () => void;
  const operationFinished = new Promise<void>((resolve) => {
    finishOperation = resolve;
  });
  const operation = admission.run("lm_studio", () => operationFinished);
  const coordinator = new UpdateReadinessCoordinator(admission, createProbes(), sqliteContext);

  try {
    const result = await coordinator.beginUpdateDrain(async () => undefined);

    assert.deepEqual(result, {
      blockers: [{
        code: "lm_studio_operation_active",
        count: 1,
        message: "One or more LM Studio runtime operations are still active."
      }],
      ok: false
    });

    assert.equal(admission.isDraining(), false);
  } finally {
    finishOperation();
    await operation;
    sqliteContext.close();
    await rm(root, { force: true, recursive: true });
  }
});
