import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

import type { SqliteMigration } from "./types.ts";

type SqliteColumnShape = {
  name: string;
  notnull: 0 | 1;
  pk: 0 | 1;
  type: string;
};

const LEGACY_PROMPT_DELIVERY_COLUMNS: SqliteColumnShape[] = [
  { name: "id", notnull: 0, pk: 1, type: "TEXT" },
  { name: "session_id", notnull: 1, pk: 0, type: "TEXT" },
  { name: "adapter_id", notnull: 1, pk: 0, type: "TEXT" },
  { name: "source_session_id", notnull: 0, pk: 0, type: "TEXT" },
  { name: "prompt_text", notnull: 1, pk: 0, type: "TEXT" },
  { name: "phase", notnull: 1, pk: 0, type: "TEXT" },
  { name: "requested_at", notnull: 1, pk: 0, type: "TEXT" },
  { name: "transport_started_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "completed_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "updated_at", notnull: 1, pk: 0, type: "TEXT" }
] as const;
const CURRENT_PROMPT_DELIVERY_COLUMNS: SqliteColumnShape[] = [
  { name: "id", notnull: 0, pk: 1, type: "TEXT" },
  { name: "session_id", notnull: 1, pk: 0, type: "TEXT" },
  { name: "adapter_id", notnull: 1, pk: 0, type: "TEXT" },
  { name: "source_session_id", notnull: 0, pk: 0, type: "TEXT" },
  { name: "prompt_text", notnull: 1, pk: 0, type: "TEXT" },
  { name: "phase", notnull: 1, pk: 0, type: "TEXT" },
  { name: "requested_at", notnull: 1, pk: 0, type: "TEXT" },
  { name: "dispatching_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "accepted_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "completed_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "updated_at", notnull: 1, pk: 0, type: "TEXT" }
] as const;

const initialWorkspaceSessionsSql = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_path ON workspaces(path);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    source_session_id TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_source_session_id ON sessions(source_session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_last_activity_at ON sessions(last_activity_at);

  CREATE TABLE IF NOT EXISTS access_devices (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    last_ip TEXT,
    revoked_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_access_devices_token_hash ON access_devices(token_hash);
  CREATE INDEX IF NOT EXISTS idx_access_devices_revoked_at ON access_devices(revoked_at);

  CREATE TABLE IF NOT EXISTS access_recovery_codes (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_access_recovery_codes_code_hash
    ON access_recovery_codes(code_hash);
  CREATE INDEX IF NOT EXISTS idx_access_recovery_codes_used_at
    ON access_recovery_codes(used_at);

  CREATE TABLE IF NOT EXISTS agent_session_reviews (
    agent_session_id TEXT PRIMARY KEY,
    reviewed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_agent_session_reviews_reviewed_at
    ON agent_session_reviews(reviewed_at);

  CREATE TABLE IF NOT EXISTS source_turn_interrupts (
    agent_id TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    managed_session_id TEXT NOT NULL,
    turn_start_entry_id TEXT NOT NULL,
    turn_fingerprint TEXT NOT NULL,
    turn_started_at TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (
      phase IN ('requested', 'confirmed_source', 'confirmed_process', 'confirmed_transport', 'unresolved')
    ),
    confirmation_kind TEXT,
    confirmation_entry_id TEXT,
    confirmed_at TEXT,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    terminal_outcome TEXT CHECK (
      terminal_outcome IN ('interrupted', 'completed', 'failed')
    ),
    PRIMARY KEY (agent_id, source_session_id, turn_fingerprint)
  );

  CREATE INDEX IF NOT EXISTS idx_source_turn_interrupts_expires_at
    ON source_turn_interrupts(expires_at);

  CREATE INDEX IF NOT EXISTS idx_source_turn_interrupts_managed_session_id
    ON source_turn_interrupts(managed_session_id);

  CREATE INDEX IF NOT EXISTS idx_source_turn_interrupts_latest_source
    ON source_turn_interrupts(agent_id, source_session_id, requested_at DESC);

  CREATE TABLE IF NOT EXISTS notification_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notification_outbox (
    key TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    provider TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    max_attempts INTEGER NOT NULL,
    next_retry_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_notification_outbox_next_retry_at
    ON notification_outbox(next_retry_at);

  CREATE TABLE IF NOT EXISTS prompt_delivery_journal (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    source_session_id TEXT,
    prompt_text TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (
      phase IN (
        'prepared',
        'dispatching',
        'accepted',
        'completed',
        'not_sent',
        'interrupted',
        'observed',
        'outcome_unknown'
      )
    ),
    requested_at TEXT NOT NULL,
    dispatching_at TEXT,
    accepted_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_prompt_delivery_journal_session
    ON prompt_delivery_journal(session_id, requested_at DESC);

  CREATE INDEX IF NOT EXISTS idx_prompt_delivery_journal_active
    ON prompt_delivery_journal(phase, updated_at);

  CREATE TABLE IF NOT EXISTS cloud_installation_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    installation_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    key_algorithm TEXT NOT NULL,
    credential_ref TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rotated_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cloud_connector_profiles (
    id TEXT PRIMARY KEY,
    identity_id INTEGER NOT NULL DEFAULT 1 REFERENCES cloud_installation_identity(id),
    cloud_origin TEXT NOT NULL,
    account_id TEXT,
    machine_id TEXT,
    display_name TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    state TEXT NOT NULL CHECK (
      state IN ('disconnected', 'connecting', 'connected', 'degraded', 'revoked')
    ),
    protocol_version INTEGER,
    last_connected_at TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cloud_connector_profiles_enabled
    ON cloud_connector_profiles(enabled, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_cloud_connector_profiles_machine
    ON cloud_connector_profiles(cloud_origin, machine_id);

  CREATE TABLE IF NOT EXISTS cloud_enrollment_attempt (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    attempt_id TEXT NOT NULL UNIQUE,
    cloud_origin TEXT NOT NULL,
    display_name TEXT NOT NULL,
    credential_ref TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    next_poll_at TEXT NOT NULL,
    poll_interval_ms INTEGER NOT NULL CHECK (poll_interval_ms BETWEEN 1000 AND 30000),
    status TEXT NOT NULL CHECK (status IN ('pending', 'failed', 'expired')),
    last_error_code TEXT,
    allow_remote_read INTEGER NOT NULL CHECK (allow_remote_read IN (0, 1)),
    allow_remote_files INTEGER NOT NULL CHECK (allow_remote_files IN (0, 1)),
    allow_remote_control INTEGER NOT NULL CHECK (allow_remote_control IN (0, 1)),
    allow_remote_preview INTEGER NOT NULL CHECK (allow_remote_preview IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cloud_connector_capabilities (
    profile_id TEXT NOT NULL REFERENCES cloud_connector_profiles(id) ON DELETE CASCADE,
    capability TEXT NOT NULL,
    local_supported INTEGER NOT NULL CHECK (local_supported IN (0, 1)),
    remote_supported INTEGER NOT NULL CHECK (remote_supported IN (0, 1)),
    negotiated_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, capability)
  );

  CREATE TABLE IF NOT EXISTS cloud_data_grants (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES cloud_connector_profiles(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    payload_kind TEXT NOT NULL CHECK (
      payload_kind IN ('artifact', 'code', 'diff', 'transcript')
    ),
    redaction_policy TEXT NOT NULL,
    granted_at TEXT NOT NULL,
    revoked_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (profile_id, device_id, workspace_id, session_id, payload_kind)
  );

  CREATE INDEX IF NOT EXISTS idx_cloud_data_grants_active
    ON cloud_data_grants(profile_id, revoked_at, workspace_id, session_id);

  CREATE TABLE IF NOT EXISTS cloud_transfer_jobs (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES cloud_connector_profiles(id) ON DELETE CASCADE,
    grant_id TEXT NOT NULL REFERENCES cloud_data_grants(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    payload_kind TEXT NOT NULL CHECK (
      payload_kind IN ('artifact', 'code', 'diff', 'transcript')
    ),
    resource_id TEXT NOT NULL,
    resource_version TEXT NOT NULL,
    state TEXT NOT NULL CHECK (
      state IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')
    ),
    attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 16),
    next_attempt_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_error_code TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cloud_transfer_jobs_due
    ON cloud_transfer_jobs(profile_id, state, next_attempt_at);

  CREATE INDEX IF NOT EXISTS idx_cloud_transfer_jobs_expiry
    ON cloud_transfer_jobs(expires_at);

  CREATE TABLE IF NOT EXISTS cloud_sync_cursors (
    profile_id TEXT NOT NULL REFERENCES cloud_connector_profiles(id) ON DELETE CASCADE,
    stream TEXT NOT NULL,
    next_outbound_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_outbound_sequence >= 1),
    last_acked_outbound_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_acked_outbound_sequence >= 0),
    last_received_inbound_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_received_inbound_sequence >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, stream),
    CHECK (last_acked_outbound_sequence < next_outbound_sequence)
  );

  CREATE TABLE IF NOT EXISTS cloud_sync_outbox (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES cloud_connector_profiles(id) ON DELETE CASCADE,
    stream TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    event_type TEXT NOT NULL,
    payload_kind TEXT NOT NULL CHECK (
      payload_kind IN ('event-cursor', 'metadata', 'source-version')
    ),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    payload_bytes INTEGER NOT NULL CHECK (payload_bytes BETWEEN 0 AND 65536),
    device_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    session_id TEXT,
    attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 16),
    next_attempt_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    acked_at TEXT,
    dead_lettered_at TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (profile_id, stream, sequence),
    CHECK (acked_at IS NULL OR dead_lettered_at IS NULL)
  );

  CREATE INDEX IF NOT EXISTS idx_cloud_sync_outbox_due
    ON cloud_sync_outbox(profile_id, acked_at, next_attempt_at);

  CREATE INDEX IF NOT EXISTS idx_cloud_sync_outbox_expiry
    ON cloud_sync_outbox(expires_at);

  CREATE TABLE IF NOT EXISTS cloud_inbound_receipts (
    profile_id TEXT NOT NULL REFERENCES cloud_connector_profiles(id) ON DELETE CASCADE,
    stream TEXT NOT NULL,
    message_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    outcome TEXT NOT NULL CHECK (
      outcome IN ('accepted', 'rejected', 'completed', 'failed')
    ),
    received_at TEXT NOT NULL,
    completed_at TEXT,
    expires_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, message_id),
    UNIQUE (profile_id, stream, sequence)
  );

  CREATE INDEX IF NOT EXISTS idx_cloud_inbound_receipts_expiry
    ON cloud_inbound_receipts(expires_at);

  CREATE TABLE IF NOT EXISTS cloud_control_receipts (
    profile_id TEXT NOT NULL REFERENCES cloud_connector_profiles(id) ON DELETE CASCADE,
    command_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    input_sha256 TEXT NOT NULL CHECK (length(input_sha256) = 64),
    outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'completed', 'failed')),
    response_status INTEGER CHECK (response_status BETWEEN 100 AND 599),
    response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
    received_at TEXT NOT NULL,
    completed_at TEXT,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, command_id)
  );

  CREATE INDEX IF NOT EXISTS idx_cloud_control_receipts_expiry
    ON cloud_control_receipts(profile_id, expires_at);
`;

const rebuildLegacyPromptDeliveryJournalSql = `
  ALTER TABLE prompt_delivery_journal RENAME TO prompt_delivery_journal_legacy;

  CREATE TABLE prompt_delivery_journal (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    source_session_id TEXT,
    prompt_text TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (
      phase IN (
        'prepared',
        'dispatching',
        'accepted',
        'completed',
        'not_sent',
        'interrupted',
        'observed',
        'outcome_unknown'
      )
    ),
    requested_at TEXT NOT NULL,
    dispatching_at TEXT,
    accepted_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );

  INSERT INTO prompt_delivery_journal (
    id,
    session_id,
    adapter_id,
    source_session_id,
    prompt_text,
    phase,
    requested_at,
    dispatching_at,
    accepted_at,
    completed_at,
    updated_at
  )
  SELECT
    id,
    session_id,
    adapter_id,
    source_session_id,
    prompt_text,
    CASE phase
      WHEN 'transport_started' THEN 'dispatching'
      ELSE phase
    END,
    requested_at,
    transport_started_at,
    NULL,
    completed_at,
    updated_at
  FROM prompt_delivery_journal_legacy;

  DROP TABLE prompt_delivery_journal_legacy;

  CREATE INDEX idx_prompt_delivery_journal_session
    ON prompt_delivery_journal(session_id, requested_at DESC);

  CREATE INDEX idx_prompt_delivery_journal_active
    ON prompt_delivery_journal(phase, updated_at);
`;

function createMigrationChecksum(source: string) {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function hasExactPromptDeliveryShape(
  database: Database.Database,
  expected: readonly SqliteColumnShape[]
) {
  const columns = database.prepare(
    "PRAGMA table_info(prompt_delivery_journal)"
  ).all() as SqliteColumnShape[];
  return (
    columns.length === expected.length &&
    columns.every(
      (column, index) => {
        const expectedColumn = expected[index];
        return Boolean(
          expectedColumn &&
          column.name === expectedColumn.name &&
          column.notnull === expectedColumn.notnull &&
          column.pk === expectedColumn.pk &&
          column.type.toUpperCase() === expectedColumn.type
        );
      }
    )
  );
}

function hasExactLegacyPromptDeliveryShape(database: Database.Database) {
  return hasExactPromptDeliveryShape(database, LEGACY_PROMPT_DELIVERY_COLUMNS);
}

function hasExactCurrentPromptDeliveryShape(database: Database.Database) {
  return hasExactPromptDeliveryShape(database, CURRENT_PROMPT_DELIVERY_COLUMNS);
}

export const initialWorkspaceSessionsMigration: SqliteMigration = {
  checksum: createMigrationChecksum(initialWorkspaceSessionsSql),
  // Before the first public release, v1 gained recovery and optional cloud
  // connector foundations. Re-apply this idempotent schema for known v1
  // checksums, then record the canonical checksum without inventing v2.
  compatibleChecksums: [
    "sha256:9084e40fea671a743ece0ffd9d0812d94502b5575dcf6a6594624d3af6000723",
    "sha256:584018118cdf885bbac8fbfd17e2e63fec2cbf038b145596fefe5273f6811a84",
    "sha256:fe1faf821b81f4379cc78a11342cbb26750bd5397159b4d62be5269f267d55dc",
    "sha256:9a9c94c906478bc582d3f948060b68d7fb3b19f03c12b0f7deeb33a1d731318c",
    "sha256:c07edfe32b42cd3089ae63671e83c4bcc6fa2ab7b1b783ec4b320e11e5898932"
  ],
  name: "initial DeskCue service schema",
  version: 1,
  apply(database) {
    database.exec(initialWorkspaceSessionsSql);
    if (hasExactLegacyPromptDeliveryShape(database)) database.exec(rebuildLegacyPromptDeliveryJournalSql);
    if (!hasExactCurrentPromptDeliveryShape(database)) {
      throw new Error("DeskCue prompt delivery journal has an unsupported pre-release shape.");
    }
  }
};
