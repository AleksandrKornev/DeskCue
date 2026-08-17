import type Database from "better-sqlite3";

import type { SessionDetail } from "@deskcue/protocol";

import type { SessionRow, SessionSummaryRow } from "./sqliteStateRows.ts";

export class SqliteSessionRepository {
  private readonly persistedJsonById = new Map<string, string>();

  constructor(private readonly database: Database.Database) {}

  loadRows() {
    const fullSessions = this.database.prepare(`
      SELECT id, json
      FROM sessions
      WHERE
        status = 'running'
        OR (
          adapter_id = 'codex'
          AND source_session_id IS NOT NULL
          AND (
            status = 'failed'
            OR json LIKE '%DeskCue daemon restarted. Session is no longer attached%'
            OR json LIKE '%DeskCue normalized a detached Codex transport%'
          )
        )
      ORDER BY started_at ASC
    `).all() as SessionRow[];
    const fullSessionIds = fullSessions.map((session) => session.id);
    const lightweightSessions = this.database.prepare(`
      SELECT
        id,
        workspace_id AS workspaceId,
        json_extract(json, '$.workspaceName') AS workspaceName,
        adapter_id AS adapterId,
        source_session_id AS sourceSessionId,
        json_extract(json, '$.command') AS command,
        status,
        started_at AS startedAt,
        json_extract(json, '$.finishedAt') AS finishedAt,
        last_activity_at AS lastActivityAt,
        json_extract(json, '$.exitCode') AS exitCode,
        json_extract(json, '$.preview') AS previewJson,
        json_extract(json, '$.replyState') AS replyStateJson,
        json_extract(json, '$.actionRequest') AS actionRequestJson,
        json_extract(json, '$.git') AS gitJson
      FROM sessions
      ${fullSessionIds.length > 0 ? `WHERE id NOT IN (${fullSessionIds.map(() => "?").join(", ")})` : ""}
      ORDER BY started_at ASC
    `).all(...fullSessionIds) as SessionSummaryRow[];
    return { fullSessions, lightweightSessions };
  }

  rememberRows(rows: SessionRow[]) {
    this.persistedJsonById.clear();
    for (const row of rows) {
      this.persistedJsonById.set(row.id, row.json);
    }
  }

  deleteMissing(ids: string[]) {
    if (ids.length === 0) {
      this.database.prepare("DELETE FROM sessions").run();
      return;
    }
    const placeholders = ids.map(() => "?").join(", ");
    this.database.prepare(`DELETE FROM sessions WHERE id NOT IN (${placeholders})`).run(...ids);
  }

  upsertChanged(sessions: SessionDetail[], partialSessionIds: Set<string>, updatedAt: string) {
    const statement = this.database.prepare(`
      INSERT INTO sessions (
        id, workspace_id, adapter_id, source_session_id, status, started_at,
        last_activity_at, json, updated_at
      )
      VALUES (
        @id, @workspaceId, @adapterId, @sourceSessionId, @status, @startedAt,
        @lastActivityAt, @json, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        adapter_id = excluded.adapter_id,
        source_session_id = excluded.source_session_id,
        status = excluded.status,
        last_activity_at = excluded.last_activity_at,
        json = excluded.json,
        updated_at = excluded.updated_at
    `);
    const persistedRows: SessionRow[] = [];
    let skipped = 0;
    for (const session of sessions) {
      if (partialSessionIds.has(session.id)) {
        skipped += 1;
        continue;
      }
      const json = JSON.stringify(session);
      if (this.persistedJsonById.get(session.id) === json) {
        skipped += 1;
        continue;
      }
      statement.run({
        id: session.id,
        workspaceId: session.workspaceId,
        adapterId: session.adapterId,
        sourceSessionId: session.sourceSessionId,
        status: session.status,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        json,
        updatedAt
      });
      persistedRows.push({ id: session.id, json });
    }
    return { persistedRows, skipped };
  }

  commitSave(sessions: SessionDetail[], persistedRows: SessionRow[], pruneMissing: boolean) {
    if (pruneMissing) {
      const nextIds = new Set(sessions.map((session) => session.id));
      for (const id of this.persistedJsonById.keys()) {
        if (!nextIds.has(id)) {
          this.persistedJsonById.delete(id);
        }
      }
    }
    for (const row of persistedRows) {
      this.persistedJsonById.set(row.id, row.json);
    }
  }
}
