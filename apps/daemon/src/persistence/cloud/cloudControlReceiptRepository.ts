import type Database from "better-sqlite3";

const CLOUD_CONTROL_RECEIPT_MAX_RECORDS = 4_096;
const CLOUD_CONTROL_RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const CLOUD_CONTROL_RECEIPT_MAX_RESPONSE_BYTES = 4_096;

export type CloudControlReceiptReservation =
  | { kind: "reserved" }
  | { kind: "conflict" }
  | { kind: "ambiguous" }
  | { kind: "replay"; status: number; body: unknown };

export class CloudControlReceiptRepository {
  constructor(private readonly database: Database.Database) {}

  reserve(input: {
    profileId: string;
    commandId: string;
    operation: string;
    inputSha256: string;
  }): CloudControlReceiptReservation {
    const now = new Date();
    const timestamp = now.toISOString();
    const expiresAt = new Date(now.getTime() + CLOUD_CONTROL_RECEIPT_TTL_MS).toISOString();
    return this.database.transaction(() => {
      this.database.prepare(`
        DELETE FROM cloud_control_receipts
        WHERE profile_id = ? AND expires_at <= ? AND outcome <> 'pending'
      `).run(input.profileId, timestamp);
      const existing = this.database.prepare(`
        SELECT operation, input_sha256 AS inputSha256, outcome,
          response_status AS responseStatus, response_json AS responseJson
        FROM cloud_control_receipts
        WHERE profile_id = ? AND command_id = ?
      `).get(input.profileId, input.commandId) as {
        operation: string;
        inputSha256: string;
        outcome: "pending" | "completed" | "failed";
        responseStatus: number | null;
        responseJson: string | null;
      } | undefined;
      if (existing) {
        if (existing.operation !== input.operation || existing.inputSha256 !== input.inputSha256) {
          return { kind: "conflict" } as const;
        }
        if (existing.outcome === "pending") return { kind: "ambiguous" } as const;
        if (existing.responseStatus === null || existing.responseJson === null) {
          return { kind: "ambiguous" } as const;
        }
        return {
          kind: "replay",
          status: existing.responseStatus,
          body: JSON.parse(existing.responseJson) as unknown
        } as const;
      }
      const count = (this.database.prepare(`
        SELECT COUNT(*) AS count FROM cloud_control_receipts WHERE profile_id = ?
      `).get(input.profileId) as { count: number }).count;
      if (count >= CLOUD_CONTROL_RECEIPT_MAX_RECORDS) {
        const removeCount = count - CLOUD_CONTROL_RECEIPT_MAX_RECORDS + 1;
        this.database.prepare(`
          DELETE FROM cloud_control_receipts WHERE rowid IN (
            SELECT rowid FROM cloud_control_receipts
            WHERE profile_id = ? AND outcome <> 'pending'
            ORDER BY updated_at ASC LIMIT ?
          )
        `).run(input.profileId, removeCount);
      }
      const boundedCount = (this.database.prepare(`
        SELECT COUNT(*) AS count FROM cloud_control_receipts WHERE profile_id = ?
      `).get(input.profileId) as { count: number }).count;
      if (boundedCount >= CLOUD_CONTROL_RECEIPT_MAX_RECORDS) {
        throw new Error("Cloud control receipt capacity was reached.");
      }
      this.database.prepare(`
        INSERT INTO cloud_control_receipts (
          profile_id, command_id, operation, input_sha256, outcome,
          received_at, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(
        input.profileId,
        input.commandId,
        input.operation,
        input.inputSha256,
        timestamp,
        expiresAt,
        timestamp
      );
      return { kind: "reserved" } as const;
    })();
  }

  complete(input: {
    profileId: string;
    commandId: string;
    status: number;
    body: unknown;
  }) {
    const now = new Date().toISOString();
    const responseJson = JSON.stringify(input.body);
    if (Buffer.byteLength(responseJson, "utf8") > CLOUD_CONTROL_RECEIPT_MAX_RESPONSE_BYTES) {
      throw new Error("Cloud control receipt response is too large.");
    }
    const result = this.database.prepare(`
      UPDATE cloud_control_receipts SET
        outcome = ?, response_status = ?, response_json = ?, completed_at = ?, updated_at = ?
      WHERE profile_id = ? AND command_id = ? AND outcome = 'pending'
    `).run(
      input.status >= 200 && input.status < 300 ? "completed" : "failed",
      input.status,
      responseJson,
      now,
      now,
      input.profileId,
      input.commandId
    );
    if (result.changes !== 1) {
      throw new Error("Cloud control receipt was not pending.");
    }
  }
}
