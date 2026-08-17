import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { listDatabaseBackups, readRecentMigrationFailures } from "./dataInspection.ts";

test("doctor stats only the bounded newest database backup set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-doctor-backups-"));
  const databaseFile = join(directory, "deskcue.sqlite");
  try {
    for (let index = 1; index <= 8; index += 1) {
      await writeFile(`${databaseFile}.backup-${String(index).padStart(2, "0")}`, `${index}`);
    }

    const result = listDatabaseBackups(databaseFile, 3);

    assert.equal(result.totalCount, 8);
    assert.deepEqual(
      result.backups.map(({ path }) => path),
      [
        `${databaseFile}.backup-08`,
        `${databaseFile}.backup-07`,
        `${databaseFile}.backup-06`
      ]
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("doctor reads recent migration failures from a bounded log tail", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-doctor-tail-"));
  const logFile = join(directory, "daemon.jsonl");
  try {
    const oldRecord = JSON.stringify({
      message: "SQLite schema migration failed",
      timestamp: "2026-01-01T00:00:00.000Z"
    });
    const recentRecord = JSON.stringify({
      context: { message: "recent failure" },
      message: "SQLite schema migration failed",
      timestamp: "2026-08-06T00:00:00.000Z"
    });
    const filler = `${"x".repeat(1024)}\n`.repeat(1_100);
    await writeFile(logFile, `${oldRecord}\n${filler}${recentRecord}\n`, "utf8");

    const failures = readRecentMigrationFailures(logFile);

    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.detail, "recent failure");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
