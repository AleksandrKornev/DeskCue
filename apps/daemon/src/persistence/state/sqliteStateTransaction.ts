import type Database from "better-sqlite3";
import { performance } from "node:perf_hooks";

import { logger } from "#infrastructure/logging/logger";

import type { SqliteSessionRepository } from "./sqliteSessionRepository.ts";
import type { SqliteWorkspaceRepository } from "./sqliteWorkspaceRepository.ts";
import type { PersistedDeskCueState, PersistedDeskCueStatePatch } from "./types.ts";

const SLOW_SQLITE_SAVE_LOG_THRESHOLD_MS = 100;

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

export function saveSqliteStateRows(options: {
  database: Database.Database;
  databaseFilePath: string;
  pruneMissingRows: boolean;
  sessionRepository: SqliteSessionRepository;
  state: PersistedDeskCueState | PersistedDeskCueStatePatch;
  workspaceRepository: SqliteWorkspaceRepository;
}) {
  const saveStartedAt = performance.now();
  const write = options.database.transaction(() => {
    let deleteDurationMs = 0;
    if (options.pruneMissingRows) {
      const deleteStartedAt = performance.now();
      options.workspaceRepository.deleteMissing(
        options.state.workspaces.map((workspace) => workspace.id)
      );
      options.sessionRepository.deleteMissing(
        options.state.sessions.map((session) => session.id)
      );
      deleteDurationMs = elapsedMs(deleteStartedAt);
    }

    const updatedAt = new Date().toISOString();
    const workspaceUpsertStartedAt = performance.now();
    const workspaceResult = options.workspaceRepository.upsertChanged(
      options.state.workspaces,
      updatedAt
    );
    const workspaceUpsertDurationMs = elapsedMs(workspaceUpsertStartedAt);

    const sessionUpsertStartedAt = performance.now();
    const sessionResult = options.sessionRepository.upsertChanged(
      options.state.sessions,
      new Set(options.state.partialSessionIds ?? []),
      updatedAt
    );
    const sessionUpsertDurationMs = elapsedMs(sessionUpsertStartedAt);
    return {
      deleteDurationMs,
      sessionResult,
      sessionUpsertDurationMs,
      workspaceResult,
      workspaceUpsertDurationMs
    };
  });

  const result = write();
  options.workspaceRepository.commitSave(
    options.state.workspaces,
    result.workspaceResult.persistedRows,
    options.pruneMissingRows
  );
  options.sessionRepository.commitSave(
    options.state.sessions,
    result.sessionResult.persistedRows,
    options.pruneMissingRows
  );

  const totalDurationMs = elapsedMs(saveStartedAt);
  if (totalDurationMs >= SLOW_SQLITE_SAVE_LOG_THRESHOLD_MS) {
    logger.info("SQLite state save completed", {
      databaseFile: options.databaseFilePath,
      workspaces: options.state.workspaces.length,
      sessions: options.state.sessions.length,
      deleteDurationMs: result.deleteDurationMs,
      prepareDurationMs: 0,
      workspaceUpsertDurationMs: result.workspaceUpsertDurationMs,
      sessionUpsertDurationMs: result.sessionUpsertDurationMs,
      skippedWorkspaces: result.workspaceResult.skipped,
      skippedSessions: result.sessionResult.skipped,
      upsertedWorkspaces: result.workspaceResult.persistedRows.length,
      upsertedSessions: result.sessionResult.persistedRows.length,
      totalDurationMs
    });
  }
}
