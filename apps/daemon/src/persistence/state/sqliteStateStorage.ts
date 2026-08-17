
import type Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

import { SqliteSessionRepository } from "./sqliteSessionRepository.ts";
import { pruneOldStateArtifacts } from "./sqliteStateArtifacts.ts";
import {
  deserializeFullSessions,
  deserializeLightweightSessions,
  deserializeWorkspaces
} from "./sqliteStateSerialization.ts";
import { saveSqliteStateRows } from "./sqliteStateTransaction.ts";
import { SqliteWorkspaceRepository } from "./sqliteWorkspaceRepository.ts";
import type {
  DaemonStateStorage,
  PersistedDeskCueState,
  PersistedDeskCueStatePatch
} from "./types.ts";
import {
  getProductionSqliteDatabaseContext,
  resolveSqliteDatabaseContext
} from "../connection/sqliteConnection.ts";
import type {
  SqliteDatabaseContext,
  SqliteDatabaseSource
} from "../connection/sqliteConnection.ts";
import {
  DESKCUE_SQLITE_SCHEMA_VERSION,
  readSqliteSchemaVersion,
  SqliteMigrationFailedError
} from "../migrations/sqliteMigrations.ts";

const SQLITE_WAL_CHECKPOINT_THRESHOLD_BYTES = 32 * 1024 * 1024;

export { DESKCUE_SQLITE_SCHEMA_VERSION };

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

export class DeskCueSqliteStateStorage implements DaemonStateStorage {
  private readonly database: Database.Database;
  private readonly databaseFilePath: string;
  private readonly databaseContext: SqliteDatabaseContext;
  private readonly ownsDatabaseContext: boolean;
  private readonly sessionRepository: SqliteSessionRepository;
  private readonly workspaceRepository: SqliteWorkspaceRepository;
  private closed = false;

  constructor(
    source: SqliteDatabaseSource = getProductionSqliteDatabaseContext(
      daemonConfig.databaseFilePath
    )
  ) {
    const resolved = resolveSqliteDatabaseContext(source);
    this.databaseContext = resolved.context;
    this.ownsDatabaseContext = resolved.ownsContext;
    this.databaseFilePath = resolved.context.databaseFilePath;
    this.database = resolved.context.database;
    this.sessionRepository = new SqliteSessionRepository(this.database);
    this.workspaceRepository = new SqliteWorkspaceRepository(this.database);
    try {
      this.migrate();
      this.verifyIntegrity();
      pruneOldStateArtifacts(dirname(this.databaseFilePath));
    } catch (error) {
      if (this.ownsDatabaseContext) {
        this.databaseContext.close();
      }
      throw error;
    }
  }

  async load(): Promise<PersistedDeskCueState> {
    try {
      const workspaceRows = this.workspaceRepository.loadRows();
      const { fullSessions, lightweightSessions } = this.sessionRepository.loadRows();
      this.workspaceRepository.rememberRows(workspaceRows);
      this.sessionRepository.rememberRows(fullSessions);
      const workspaces = deserializeWorkspaces(workspaceRows);
      const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
      const deserializedFullSessions = deserializeFullSessions(fullSessions);
      const deserializedLightweightSessions = deserializeLightweightSessions(lightweightSessions);
      const sessions = [
        ...deserializedFullSessions,
        ...deserializedLightweightSessions
      ].filter((session) => workspaceIds.has(session.workspaceId));
      const orphanedSessionCount = deserializedFullSessions.length +
        deserializedLightweightSessions.length - sessions.length;
      if (orphanedSessionCount > 0) {
        logger.warn("Quarantining persisted sessions without a valid workspace", {
          count: orphanedSessionCount
        });
      }

      return {
        version: 1,
        workspaces,
        sessions: sessions.sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
        partialSessionIds: deserializedLightweightSessions
          .filter((session) => workspaceIds.has(session.workspaceId))
          .map((session) => session.id)
      };
    } catch (error) {
      logger.error("Failed to load daemon SQLite state", {
        databaseFile: this.databaseFilePath,
        message: error instanceof Error ? error.message : "Failed to read daemon database."
      });
      throw error;
    }
  }

  async save(state: PersistedDeskCueState) {
    this.saveRows(state, true);
  }

  async savePatch(state: PersistedDeskCueStatePatch) {
    this.saveRows(state, false);
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.checkpointWalIfLarge("close");
    if (this.ownsDatabaseContext) {
      this.databaseContext.close();
    }
  }

  readSchemaVersion() {
    return readSqliteSchemaVersion(this.database);
  }

  checkpointWalIfLarge(reason = "maintenance") {
    const walFilePath = `${this.databaseFilePath}-wal`;
    if (!existsSync(walFilePath)) {
      return;
    }
    const walSizeBytes = statSync(walFilePath).size;
    if (walSizeBytes < SQLITE_WAL_CHECKPOINT_THRESHOLD_BYTES) {
      return;
    }

    const checkpointStartedAt = performance.now();
    const result = this.database.pragma("wal_checkpoint(TRUNCATE)");
    const durationMs = elapsedMs(checkpointStartedAt);
    const nextWalSizeBytes = existsSync(walFilePath) ? statSync(walFilePath).size : 0;
    logger.info("SQLite WAL checkpoint completed", {
      databaseFile: this.databaseFilePath,
      durationMs,
      nextWalSizeBytes,
      reason,
      result,
      walSizeBytes
    });
  }

  private saveRows(
    state: PersistedDeskCueState | PersistedDeskCueStatePatch,
    pruneMissingRows: boolean
  ) {
    saveSqliteStateRows({
      database: this.database,
      databaseFilePath: this.databaseFilePath,
      pruneMissingRows,
      sessionRepository: this.sessionRepository,
      state,
      workspaceRepository: this.workspaceRepository
    });
  }

  private verifyIntegrity() {
    const rows = this.database.pragma("quick_check(1)") as Array<{ quick_check: string }>;
    if (rows.length === 1 && rows[0]?.quick_check === "ok") {
      return;
    }
    throw new Error(
      `DeskCue SQLite integrity check failed: ${rows.map((row) => row.quick_check).join("; ") || "unknown error"}`
    );
  }

  private migrate() {
    let result;
    try {
      result = this.databaseContext.ensureMigrated();
    } catch (error) {
      if (error instanceof SqliteMigrationFailedError) {
        logger.error("SQLite schema migration failed", {
          backupPath: error.backupPath,
          databaseFile: this.databaseFilePath,
          fromVersion: error.fromVersion,
          message: readErrorMessage(error.cause ?? error),
          toVersion: error.toVersion
        });
      } else {
        logger.error("SQLite schema migration failed", {
          databaseFile: this.databaseFilePath,
          message: readErrorMessage(error),
          toVersion: DESKCUE_SQLITE_SCHEMA_VERSION
        });
      }
      throw error;
    }

    if (result.fromVersion !== result.toVersion) {
      logger.info("SQLite schema migrated", {
        backupPath: result.backupPath,
        databaseFile: this.databaseFilePath,
        fromVersion: result.fromVersion,
        toVersion: result.toVersion
      });
    }
  }
}
