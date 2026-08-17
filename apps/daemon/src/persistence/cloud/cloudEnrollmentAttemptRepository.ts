import type Database from "better-sqlite3";

export type CloudEnrollmentAttemptRecord = {
  attemptId: string;
  cloudOrigin: string;
  displayName: string;
  credentialRef: string;
  expiresAt: string;
  nextPollAt: string;
  pollIntervalMs: number;
  status: "pending" | "failed" | "expired";
  lastErrorCode: string | null;
  allowRemoteRead: boolean;
  allowRemoteFiles: boolean;
  allowRemoteControl: boolean;
  allowRemotePreview: boolean;
};

type StoredAttempt = Omit<
  CloudEnrollmentAttemptRecord,
  "allowRemoteRead" | "allowRemoteFiles" | "allowRemoteControl" | "allowRemotePreview"
> & {
  allowRemoteRead: number;
  allowRemoteFiles: number;
  allowRemoteControl: number;
  allowRemotePreview: number;
};

function normalizeAttempt(attempt: StoredAttempt): CloudEnrollmentAttemptRecord {
  return {
    ...attempt,
    allowRemoteRead: attempt.allowRemoteRead === 1,
    allowRemoteFiles: attempt.allowRemoteFiles === 1,
    allowRemoteControl: attempt.allowRemoteControl === 1,
    allowRemotePreview: attempt.allowRemotePreview === 1
  };
}

export class CloudEnrollmentAttemptRepository {
  constructor(private readonly database: Database.Database) {}

  read(): CloudEnrollmentAttemptRecord | null {
    const attempt = this.database.prepare(`
      SELECT attempt_id AS attemptId, cloud_origin AS cloudOrigin,
        display_name AS displayName, credential_ref AS credentialRef,
        expires_at AS expiresAt, next_poll_at AS nextPollAt,
        poll_interval_ms AS pollIntervalMs, status,
        last_error_code AS lastErrorCode,
        allow_remote_read AS allowRemoteRead,
        allow_remote_files AS allowRemoteFiles,
        allow_remote_control AS allowRemoteControl,
        allow_remote_preview AS allowRemotePreview
      FROM cloud_enrollment_attempt WHERE id = 1
    `).get() as StoredAttempt | undefined;
    return attempt ? normalizeAttempt(attempt) : null;
  }

  replace(attempt: CloudEnrollmentAttemptRecord) {
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO cloud_enrollment_attempt (
        id, attempt_id, cloud_origin, display_name, credential_ref,
        expires_at, next_poll_at, poll_interval_ms, status, last_error_code,
        allow_remote_read, allow_remote_files, allow_remote_control,
        allow_remote_preview, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        attempt_id = excluded.attempt_id,
        cloud_origin = excluded.cloud_origin,
        display_name = excluded.display_name,
        credential_ref = excluded.credential_ref,
        expires_at = excluded.expires_at,
        next_poll_at = excluded.next_poll_at,
        poll_interval_ms = excluded.poll_interval_ms,
        status = excluded.status,
        last_error_code = excluded.last_error_code,
        allow_remote_read = excluded.allow_remote_read,
        allow_remote_files = excluded.allow_remote_files,
        allow_remote_control = excluded.allow_remote_control,
        allow_remote_preview = excluded.allow_remote_preview,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      attempt.attemptId,
      attempt.cloudOrigin,
      attempt.displayName,
      attempt.credentialRef,
      attempt.expiresAt,
      attempt.nextPollAt,
      attempt.pollIntervalMs,
      attempt.status,
      attempt.lastErrorCode,
      attempt.allowRemoteRead ? 1 : 0,
      attempt.allowRemoteFiles ? 1 : 0,
      attempt.allowRemoteControl ? 1 : 0,
      attempt.allowRemotePreview ? 1 : 0,
      now,
      now
    );
  }

  scheduleNext(
    nextPollAt: string,
    pollIntervalMs: number,
    lastErrorCode: string | null = null
  ) {
    this.database.prepare(`
      UPDATE cloud_enrollment_attempt
      SET next_poll_at = ?, poll_interval_ms = ?, last_error_code = ?, updated_at = ?
      WHERE id = 1
    `).run(nextPollAt, pollIntervalMs, lastErrorCode, new Date().toISOString());
  }

  mark(status: "failed" | "expired", lastErrorCode: string | null) {
    this.database.prepare(`
      UPDATE cloud_enrollment_attempt
      SET status = ?, last_error_code = ?, updated_at = ?
      WHERE id = 1
    `).run(status, lastErrorCode, new Date().toISOString());
  }

  remove() {
    this.database.prepare("DELETE FROM cloud_enrollment_attempt WHERE id = 1").run();
  }
}
