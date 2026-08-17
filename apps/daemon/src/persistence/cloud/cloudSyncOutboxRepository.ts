import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

import type { CloudRelayEnvelope, CloudRelaySessionSummary } from "@deskcue/protocol";

const CLOUD_STREAM = "session-summaries";
const CLOUD_OUTBOX_MAX_RECORDS = 4_096;
const CLOUD_OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const CLOUD_OUTBOX_MAX_ATTEMPTS = 16;
// A rewritten message may already have reached Cloud while its ACK was lost.
// Keep it safe for replay, then force one new message id to clear persisted labels.
const CLOUD_OUTBOX_LABELS_REDACTED_CODE = "labels_redacted_locally";

export class CloudSyncOutboxRepository {
  constructor(private readonly database: Database.Database) {}

  enqueueSummaries(profileId: string, summaries: CloudRelaySessionSummary[]) {
    if (summaries.length === 0) return 0;
    const transaction = this.database.transaction(() => {
      this.database.prepare(`
        DELETE FROM cloud_sync_outbox
        WHERE profile_id = ? AND expires_at <= ?
          AND (acked_at IS NOT NULL OR dead_lettered_at IS NOT NULL)
      `).run(profileId, new Date().toISOString());
      const existingCount = (this.database.prepare(`
        SELECT COUNT(*) AS count FROM cloud_sync_outbox
        WHERE profile_id = ? AND acked_at IS NULL AND dead_lettered_at IS NULL
      `).get(profileId) as { count: number }).count;
      let pendingCount = existingCount;
      let added = 0;
      for (const summary of summaries) {
        const payload = JSON.stringify({ type: "session.summary", summary });
        const latest = this.database.prepare(`
          SELECT payload_json AS payloadJson, last_error_code AS lastErrorCode
          FROM cloud_sync_outbox
          WHERE profile_id = ? AND session_id = ?
          ORDER BY sequence DESC LIMIT 1
        `).get(profileId, summary.sessionId) as {
          payloadJson: string;
          lastErrorCode: string | null;
        } | undefined;
        if (
          latest?.payloadJson === payload &&
          latest.lastErrorCode !== CLOUD_OUTBOX_LABELS_REDACTED_CODE
        ) continue;
        if (pendingCount >= CLOUD_OUTBOX_MAX_RECORDS) {
          throw new Error("Cloud sync outbox capacity was reached.");
        }
        const now = new Date();
        const timestamp = now.toISOString();
        const cursor = this.ensureCursor(profileId, timestamp);
        const id = `msg_${randomUUID()}`;
        this.database.prepare(`
          INSERT INTO cloud_sync_outbox (
            id, profile_id, stream, sequence, event_type, payload_kind,
            payload_json, payload_bytes, device_id, workspace_id, session_id,
            attempt, max_attempts, next_attempt_at, expires_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'session.summary', 'metadata', ?, ?,
            'local-daemon', 'local', ?, 0, ?, ?, ?, ?, ?)
        `).run(
          id,
          profileId,
          CLOUD_STREAM,
          cursor.nextOutboundSequence,
          payload,
          Buffer.byteLength(payload, "utf8"),
          summary.sessionId,
          CLOUD_OUTBOX_MAX_ATTEMPTS,
          timestamp,
          new Date(now.getTime() + CLOUD_OUTBOX_TTL_MS).toISOString(),
          timestamp,
          timestamp
        );
        this.database.prepare(`
          UPDATE cloud_sync_cursors SET next_outbound_sequence = ?, updated_at = ?
          WHERE profile_id = ? AND stream = ?
        `).run(cursor.nextOutboundSequence + 1, timestamp, profileId, CLOUD_STREAM);
        pendingCount += 1;
        added += 1;
      }
      return added;
    });
    return transaction();
  }

  redactPendingSessionLabels(profileId: string) {
    const rows = this.database.prepare(`
      SELECT id, payload_json AS payloadJson
      FROM cloud_sync_outbox
      WHERE profile_id = ? AND event_type = 'session.summary'
        AND acked_at IS NULL AND dead_lettered_at IS NULL
    `).all(profileId) as Array<{ id: string; payloadJson: string }>;
    const update = this.database.prepare(`
      UPDATE cloud_sync_outbox
      SET payload_json = ?, payload_bytes = ?, last_error_code = ?, updated_at = ?
      WHERE id = ? AND profile_id = ?
    `);
    const now = new Date().toISOString();
    const transaction = this.database.transaction(() => {
      for (const row of rows) {
        const payload = JSON.parse(row.payloadJson) as CloudRelayEnvelope["payload"];
        const summary: CloudRelaySessionSummary = {
          sessionId: payload.summary.sessionId,
          runtime: payload.summary.runtime,
          status: payload.summary.status,
          replyState: payload.summary.replyState,
          updatedAt: payload.summary.updatedAt,
          disclosureScope: "metadata_only"
        };
        const payloadJson = JSON.stringify({ type: "session.summary", summary });
        update.run(
          payloadJson,
          Buffer.byteLength(payloadJson, "utf8"),
          CLOUD_OUTBOX_LABELS_REDACTED_CODE,
          now,
          row.id,
          profileId
        );
      }
    });
    transaction();
  }

  readLastAckedSequence(profileId: string) {
    return this.ensureCursor(profileId, new Date().toISOString()).lastAckedOutboundSequence;
  }

  reconcileServerPosition(profileId: string, nextSequence: number) {
    const now = new Date().toISOString();
    const transaction = this.database.transaction(() => {
      const cursor = this.ensureCursor(profileId, now);
      if (!Number.isSafeInteger(nextSequence) || nextSequence < 1 ||
          nextSequence > cursor.nextOutboundSequence) {
        throw new Error("Cloud relay server position is outside the durable outbox.");
      }
      this.database.prepare(`
        UPDATE cloud_sync_outbox
        SET acked_at = COALESCE(acked_at, ?), updated_at = ?
        WHERE profile_id = ? AND stream = ? AND sequence < ?
      `).run(now, now, profileId, CLOUD_STREAM, nextSequence);
      this.database.prepare(`
        UPDATE cloud_sync_cursors SET
          next_outbound_sequence = ?,
          last_acked_outbound_sequence = ?,
          updated_at = ?
        WHERE profile_id = ? AND stream = ?
      `).run(
        Math.max(cursor.nextOutboundSequence, nextSequence),
        Math.max(cursor.lastAckedOutboundSequence, nextSequence - 1),
        now,
        profileId,
        CLOUD_STREAM
      );
    });
    transaction();
  }

  readEnvelope(profileId: string, fromSequence: number): CloudRelayEnvelope | null {
    const row = this.database.prepare(`
      SELECT id, sequence, payload_json AS payloadJson, created_at AS createdAt
      FROM cloud_sync_outbox
      WHERE profile_id = ? AND stream = ? AND sequence >= ? AND dead_lettered_at IS NULL
      ORDER BY sequence ASC LIMIT 1
    `).get(profileId, CLOUD_STREAM, fromSequence) as {
      id: string;
      sequence: number;
      payloadJson: string;
      createdAt: string;
    } | undefined;
    if (!row) return null;
    const payload = JSON.parse(row.payloadJson) as CloudRelayEnvelope["payload"];
    const { disclosureScope = "metadata_only", ...summary } = payload.summary;
    return {
      protocolVersion: 1,
      messageId: row.id,
      stream: CLOUD_STREAM,
      sequence: row.sequence,
      sentAt: row.createdAt,
      payload: {
        ...payload,
        summary: {
          ...summary,
          disclosureScope
        }
      }
    };
  }

  markAttempt(profileId: string, messageId: string) {
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE cloud_sync_outbox SET attempt = attempt + 1, updated_at = ?
      WHERE profile_id = ? AND id = ?
    `).run(now, profileId, messageId);
  }

  acknowledge(profileId: string, messageId: string, sequence: number) {
    const now = new Date().toISOString();
    const transaction = this.database.transaction(() => {
      const row = this.database.prepare(`
        SELECT sequence FROM cloud_sync_outbox WHERE profile_id = ? AND id = ?
      `).get(profileId, messageId) as { sequence: number } | undefined;
      if (!row || row.sequence !== sequence) {
        throw new Error("Cloud relay acknowledgement does not match the durable outbox.");
      }
      this.database.prepare(`
        UPDATE cloud_sync_outbox SET acked_at = COALESCE(acked_at, ?), updated_at = ?
        WHERE profile_id = ? AND sequence <= ?
      `).run(now, now, profileId, sequence);
      const cursor = this.ensureCursor(profileId, now);
      this.database.prepare(`
        UPDATE cloud_sync_cursors SET last_acked_outbound_sequence = ?, updated_at = ?
        WHERE profile_id = ? AND stream = ?
      `).run(Math.max(cursor.lastAckedOutboundSequence, sequence), now, profileId, CLOUD_STREAM);
    });
    transaction();
  }

  reject(profileId: string, messageId: string, errorCode: string, _retryable: boolean) {
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE cloud_sync_outbox SET
        last_error_code = ?,
        dead_lettered_at = NULL,
        updated_at = ?
      WHERE profile_id = ? AND id = ?
    `).run(errorCode, now, profileId, messageId);
  }

  countPending(profileId: string | null) {
    if (!profileId) return 0;
    return (this.database.prepare(`
      SELECT COUNT(*) AS count FROM cloud_sync_outbox
      WHERE profile_id = ? AND acked_at IS NULL AND dead_lettered_at IS NULL
    `).get(profileId) as { count: number }).count;
  }

  ensureCursor(profileId: string, now: string) {
    this.database.prepare(`
      INSERT INTO cloud_sync_cursors (
        profile_id, stream, next_outbound_sequence,
        last_acked_outbound_sequence, last_received_inbound_sequence, updated_at
      ) VALUES (?, ?, 1, 0, 0, ?)
      ON CONFLICT(profile_id, stream) DO NOTHING
    `).run(profileId, CLOUD_STREAM, now);
    return this.database.prepare(`
      SELECT next_outbound_sequence AS nextOutboundSequence,
        last_acked_outbound_sequence AS lastAckedOutboundSequence
      FROM cloud_sync_cursors WHERE profile_id = ? AND stream = ?
    `).get(profileId, CLOUD_STREAM) as {
      nextOutboundSequence: number;
      lastAckedOutboundSequence: number;
    };
  }
}
