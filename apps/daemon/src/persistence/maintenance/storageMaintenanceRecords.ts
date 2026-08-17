import type Database from "better-sqlite3";

const DEFAULT_AGENT_SESSION_REVIEW_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_PROMPT_DELIVERY_JOURNAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function pruneExpiredMaintenanceRecords(
  database: Database.Database,
  now: Date
) {
  database.prepare("DELETE FROM source_turn_interrupts WHERE expires_at <= ?").run(now.toISOString());
  database.prepare(`
    DELETE FROM access_recovery_codes
    WHERE used_at IS NOT NULL OR expires_at <= ?
  `).run(now.toISOString());
  database
    .prepare("DELETE FROM agent_session_reviews WHERE reviewed_at <= ?")
    .run(
      new Date(now.getTime() - DEFAULT_AGENT_SESSION_REVIEW_RETENTION_MS).toISOString()
    );
  database.prepare(`
    DELETE FROM prompt_delivery_journal
    WHERE phase IN (
      'completed',
      'interrupted',
      'observed'
    )
      AND updated_at <= ?
  `).run(
    new Date(now.getTime() - DEFAULT_PROMPT_DELIVERY_JOURNAL_RETENTION_MS).toISOString()
  );
}
