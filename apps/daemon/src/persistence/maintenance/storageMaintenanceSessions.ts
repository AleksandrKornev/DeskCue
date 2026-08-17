import type Database from "better-sqlite3";

import type { SessionDetail } from "@deskcue/protocol";

export type DuplicateAttachedGroupRow = {
  adapterId: string;
  sourceSessionId: string;
  count: number;
  jsonBytes: number | null;
};

type SessionCacheRow = {
  id: string;
  json: string;
  jsonBytes: number;
};

export function listDuplicateAttachedGroups(database: Database.Database) {
  return database.prepare(`
    SELECT
      adapter_id AS adapterId,
      source_session_id AS sourceSessionId,
      COUNT(*) AS count,
      COALESCE(SUM(LENGTH(json)), 0) AS jsonBytes
    FROM sessions
    WHERE source_session_id IS NOT NULL AND status = 'read_only'
    GROUP BY adapter_id, source_session_id
    HAVING COUNT(*) > 1
    ORDER BY jsonBytes DESC, count DESC
    LIMIT 20
  `).all() as DuplicateAttachedGroupRow[];
}

export function pruneDuplicateAttachedSessions(database: Database.Database) {
  return database.prepare(`
    DELETE FROM sessions
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY adapter_id, source_session_id
          ORDER BY last_activity_at DESC, started_at DESC, id DESC
        ) AS rowNumber
        FROM sessions
        WHERE source_session_id IS NOT NULL AND status = 'read_only'
      ) WHERE rowNumber > 1
    )
  `).run().changes;
}

export function countOldAttachedSessions(
  database: Database.Database,
  retentionMs: number,
  now: Date
) {
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();
  const row = database.prepare(`
    SELECT COUNT(*) AS count FROM sessions
    WHERE
      source_session_id IS NOT NULL
      AND status IN ('read_only', 'stopped', 'done', 'failed')
      AND last_activity_at < ?
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY adapter_id, source_session_id
            ORDER BY last_activity_at DESC, started_at DESC, id DESC
          ) AS rowNumber
          FROM sessions WHERE source_session_id IS NOT NULL
        ) WHERE rowNumber = 1
      )
  `).get(cutoff) as { count: number };
  return row.count;
}

export function pruneOldAttachedSessions(
  database: Database.Database,
  retentionMs: number,
  now: Date
) {
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();
  return database.prepare(`
    DELETE FROM sessions
    WHERE
      source_session_id IS NOT NULL
      AND status IN ('read_only', 'stopped', 'done', 'failed')
      AND last_activity_at < ?
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY adapter_id, source_session_id
            ORDER BY last_activity_at DESC, started_at DESC, id DESC
          ) AS rowNumber
          FROM sessions WHERE source_session_id IS NOT NULL
        ) WHERE rowNumber = 1
      )
  `).run(cutoff).changes;
}

export function pruneTerminalSessions(
  database: Database.Database,
  retentionMs: number,
  maxSessions: number,
  now: Date
) {
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();
  return database.prepare(`
    DELETE FROM sessions
    WHERE status IN ('read_only', 'stopped', 'done', 'failed')
      AND (
        last_activity_at < ? OR id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              ORDER BY last_activity_at DESC, started_at DESC, id DESC
            ) AS rowNumber
            FROM sessions WHERE status IN ('read_only', 'stopped', 'done', 'failed')
          ) WHERE rowNumber > ?
        )
      )
  `).run(cutoff, maxSessions).changes;
}

export function purgeTerminalSessions(database: Database.Database) {
  return database.prepare(`
    DELETE FROM sessions
    WHERE status IN ('read_only', 'stopped', 'done', 'failed')
  `).run().changes;
}

function compactSessionPayloadJson(json: string) {
  try {
    const session = JSON.parse(json) as SessionDetail;
    return JSON.stringify({
      ...session,
      git: { ...session.git, changedFiles: [], diff: "" },
      inputHistory: [],
      logs: []
    } satisfies SessionDetail);
  } catch {
    return null;
  }
}

function compactInactiveSessionCache(
  database: Database.Database,
  whereClause: string,
  maxBytes: number
) {
  const rows = database.prepare(`
    SELECT id, json, LENGTH(json) AS jsonBytes
    FROM sessions
    WHERE ${whereClause}
    ORDER BY last_activity_at DESC, started_at DESC, id DESC
  `).all() as SessionCacheRow[];
  const update = database.prepare("UPDATE sessions SET json = ?, updated_at = ? WHERE id = ?");
  let retainedBytes = 0;
  let compactedBytes = 0;
  let compactedSessions = 0;

  for (const row of rows) {
    if (retainedBytes + row.jsonBytes <= maxBytes || retainedBytes === 0) {
      retainedBytes += row.jsonBytes;
      continue;
    }

    const compactedJson = compactSessionPayloadJson(row.json);
    if (!compactedJson || compactedJson === row.json) {
      continue;
    }

    update.run(compactedJson, new Date().toISOString(), row.id);
    compactedBytes += row.jsonBytes - Buffer.byteLength(compactedJson);
    compactedSessions += 1;
    retainedBytes += Buffer.byteLength(compactedJson);
  }

  return { compactedBytes, compactedSessions };
}

export function compactInactiveAttachedSessionCache(
  database: Database.Database,
  maxBytes: number
) {
  return compactInactiveSessionCache(
    database,
    `source_session_id IS NOT NULL AND status IN ('read_only', 'stopped', 'done', 'failed')`,
    maxBytes
  );
}

export function compactInactiveManagedSessionCache(
  database: Database.Database,
  maxBytes: number
) {
  return compactInactiveSessionCache(
    database,
    `source_session_id IS NULL AND status IN ('stopped', 'done', 'failed')`,
    maxBytes
  );
}

function readInactiveSessionJsonBytes(database: Database.Database, whereClause: string) {
  const row = database.prepare(`
    SELECT COALESCE(SUM(LENGTH(json)), 0) AS jsonBytes
    FROM sessions WHERE ${whereClause}
  `).get() as { jsonBytes: number | null };
  return row.jsonBytes ?? 0;
}

export function readInactiveAttachedJsonBytes(database: Database.Database) {
  return readInactiveSessionJsonBytes(
    database,
    `source_session_id IS NOT NULL AND status IN ('read_only', 'stopped', 'done', 'failed')`
  );
}

export function readInactiveManagedJsonBytes(database: Database.Database) {
  return readInactiveSessionJsonBytes(
    database,
    `source_session_id IS NULL AND status IN ('stopped', 'done', 'failed')`
  );
}

export function pruneRevokedAccessDevices(
  database: Database.Database,
  retentionMs: number,
  now: Date
) {
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();
  return database.prepare(`
    DELETE FROM access_devices
    WHERE revoked_at IS NOT NULL AND revoked_at < ?
  `).run(cutoff).changes;
}
