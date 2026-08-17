import type Database from "better-sqlite3";

import type { AgentSessionDetail, AgentSessionSummary } from "@deskcue/protocol";
import type { AgentSessionReviewStore } from "#application/ports";
import { daemonConfig } from "#config/daemonConfig";

import {
  getProductionSqliteDatabaseContext,
  initializeSqliteDatabaseContext
} from "../connection/sqliteConnection.ts";
import type {
  SqliteDatabaseContext,
  SqliteDatabaseSource
} from "../connection/sqliteConnection.ts";

type AgentSessionReviewRow = {
  reviewedAt: string;
};

export class SqliteAgentSessionReviewStore implements AgentSessionReviewStore {
  private readonly database: Database.Database;
  private readonly databaseContext: SqliteDatabaseContext;
  private readonly ownsDatabaseContext: boolean;
  private readonly readReviewedAtStatement: Database.Statement<[string], AgentSessionReviewRow>;
  private readonly markReviewedStatement: Database.Statement<[string, string, string]>;

  constructor(
    source: SqliteDatabaseSource = getProductionSqliteDatabaseContext(
      daemonConfig.databaseFilePath
    )
  ) {
    const resolved = initializeSqliteDatabaseContext(source);
    this.databaseContext = resolved.context;
    this.ownsDatabaseContext = resolved.ownsContext;
    this.database = resolved.context.database;
    this.readReviewedAtStatement = this.database.prepare(`
      SELECT reviewed_at AS reviewedAt
      FROM agent_session_reviews
      WHERE agent_session_id = ?
    `);
    this.markReviewedStatement = this.database.prepare(`
      INSERT INTO agent_session_reviews (agent_session_id, reviewed_at, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(agent_session_id)
      DO UPDATE SET
        reviewed_at = excluded.reviewed_at,
        updated_at = excluded.updated_at
    `);
  }

  close() {
    if (this.ownsDatabaseContext) {
      this.databaseContext.close();
    }
  }

  readReviewedAt(agentSessionId: string) {
    return this.readReviewedAtStatement.get(agentSessionId)?.reviewedAt ?? null;
  }

  markReviewed(agentSessionId: string, reviewedAt = new Date().toISOString()) {
    this.markReviewedStatement.run(agentSessionId, reviewedAt, reviewedAt);
    return reviewedAt;
  }

  decorateSession<T extends AgentSessionSummary | AgentSessionDetail>(session: T): T {
    return {
      ...session,
      reviewedAt: this.readReviewedAt(session.id)
    };
  }

  decorateSessions<T extends AgentSessionSummary | AgentSessionDetail>(sessions: T[]): T[] {
    return sessions.map((session) => this.decorateSession(session));
  }
}
