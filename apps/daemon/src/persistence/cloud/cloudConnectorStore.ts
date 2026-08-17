import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

import type {
  CloudConnectorState,
  CloudRelayEnvelope,
  CloudRelaySessionSummary,
  UpdateCloudPermissionsInput
} from "@deskcue/protocol";
import type { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";

import { CloudControlReceiptRepository } from "./cloudControlReceiptRepository.ts";
import type { CloudControlReceiptReservation } from "./cloudControlReceiptRepository.ts";
import { CloudSyncOutboxRepository } from "./cloudSyncOutboxRepository.ts";

export type CloudInstallationIdentity = {
  installationId: string;
  publicKey: string;
  credentialRef: string;
};

export type CloudConnectorProfile = {
  id: string;
  cloudOrigin: string;
  displayName: string;
  enabled: boolean;
  state: CloudConnectorState;
  machineId: string | null;
  protocolVersion: number | null;
  lastConnectedAt: string | null;
  lastErrorCode: string | null;
  credentialRef: string;
  remoteReadEnabled: boolean;
  remoteFilesEnabled: boolean;
  remoteControlEnabled: boolean;
  remotePreviewEnabled: boolean;
  sessionLabelDisclosureEnabled: boolean;
};

export type { CloudControlReceiptReservation } from "./cloudControlReceiptRepository.ts";

function normalizeProfile(
  profile: Omit<CloudConnectorProfile, "enabled" | "remoteReadEnabled" | "remoteFilesEnabled" | "remoteControlEnabled" | "remotePreviewEnabled" | "sessionLabelDisclosureEnabled"> & {
    enabled: number;
    remoteReadEnabled: number;
    remoteFilesEnabled: number;
    remoteControlEnabled: number;
    remotePreviewEnabled: number;
    sessionLabelDisclosureEnabled: number;
  }
): CloudConnectorProfile {
  return {
    ...profile,
    enabled: profile.enabled === 1,
    remoteReadEnabled: profile.remoteReadEnabled === 1,
    remoteFilesEnabled: profile.remoteFilesEnabled === 1,
    remoteControlEnabled: profile.remoteControlEnabled === 1,
    remotePreviewEnabled: profile.remotePreviewEnabled === 1,
    sessionLabelDisclosureEnabled: profile.sessionLabelDisclosureEnabled === 1
  };
}

export class SqliteCloudConnectorStore {
  private readonly database: Database.Database;
  private readonly controlReceipts: CloudControlReceiptRepository;
  private readonly outbox: CloudSyncOutboxRepository;

  constructor(context: SqliteDatabaseContext) {
    context.ensureMigrated();
    this.database = context.database;
    this.controlReceipts = new CloudControlReceiptRepository(this.database);
    this.outbox = new CloudSyncOutboxRepository(this.database);
  }

  readIdentity(): CloudInstallationIdentity | null {
    return (this.database.prepare(`
      SELECT installation_id AS installationId, public_key AS publicKey,
        credential_ref AS credentialRef
      FROM cloud_installation_identity WHERE id = 1
    `).get() as CloudInstallationIdentity | undefined) ?? null;
  }

  createIdentity(identity: CloudInstallationIdentity) {
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO cloud_installation_identity (
        id, installation_id, public_key, key_algorithm, credential_ref,
        created_at, updated_at
      ) VALUES (1, ?, ?, 'ed25519', ?, ?, ?)
    `).run(
      identity.installationId,
      identity.publicKey,
      identity.credentialRef,
      now,
      now
    );
  }

  updateIdentityPublicKey(publicKey: string) {
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE cloud_installation_identity
      SET public_key = ?, rotated_at = ?, updated_at = ?
      WHERE id = 1
    `).run(publicKey, now, now);
  }

  readActiveProfile(): CloudConnectorProfile | null {
    return this.readProfile(`WHERE profile.enabled = 1 ORDER BY profile.updated_at DESC LIMIT 1`);
  }

  readLatestProfile(): CloudConnectorProfile | null {
    return this.readProfile(`ORDER BY profile.updated_at DESC LIMIT 1`);
  }

  enrollProfile(input: {
    cloudOrigin: string;
    displayName: string;
    machineId: string;
    allowRemoteRead: boolean;
    allowRemoteFiles?: boolean;
    allowRemoteControl: boolean;
    allowRemotePreview?: boolean;
  }): CloudConnectorProfile {
    const now = new Date().toISOString();
    const existing = this.database.prepare(`
      SELECT id, machine_id AS machineId
      FROM cloud_connector_profiles
      WHERE cloud_origin = ?
      ORDER BY updated_at DESC LIMIT 1
    `).get(input.cloudOrigin) as { id: string; machineId: string | null } | undefined;
    const profileId = existing?.id ?? randomUUID();
    const machineIdentityChanged = Boolean(
      existing?.machineId && existing.machineId !== input.machineId
    );
    const transaction = this.database.transaction(() => {
      this.database.prepare(`
        UPDATE cloud_connector_profiles
        SET enabled = 0, state = 'disconnected', updated_at = ?
        WHERE id <> ? AND enabled = 1
      `).run(now, profileId);
      this.database.prepare(`
        INSERT INTO cloud_connector_profiles (
          id, cloud_origin, machine_id, display_name, enabled, state,
          protocol_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 'connecting', 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          cloud_origin = excluded.cloud_origin,
          machine_id = excluded.machine_id,
          display_name = excluded.display_name,
          enabled = 1,
          state = 'connecting',
          protocol_version = 1,
          last_error_code = NULL,
          updated_at = excluded.updated_at
      `).run(profileId, input.cloudOrigin, input.machineId, input.displayName, now, now);
      this.database.prepare(`
        INSERT INTO cloud_connector_capabilities (
          profile_id, capability, local_supported, remote_supported,
          negotiated_at, updated_at
        ) VALUES (?, 'session.summary', 1, 0, NULL, ?)
        ON CONFLICT(profile_id, capability) DO UPDATE SET
          local_supported = 1,
          remote_supported = 0,
          negotiated_at = NULL,
          updated_at = excluded.updated_at
      `).run(profileId, now);
      this.database.prepare(`
        INSERT INTO cloud_connector_capabilities (
          profile_id, capability, local_supported, remote_supported,
          negotiated_at, updated_at
        ) VALUES (?, 'deskcue.read', ?, 0, NULL, ?)
        ON CONFLICT(profile_id, capability) DO UPDATE SET
          local_supported = excluded.local_supported,
          remote_supported = 0,
          negotiated_at = NULL,
          updated_at = excluded.updated_at
      `).run(profileId, input.allowRemoteRead ? 1 : 0, now);
      this.database.prepare(`
        INSERT INTO cloud_connector_capabilities (
          profile_id, capability, local_supported, remote_supported,
          negotiated_at, updated_at
        ) VALUES (?, 'deskcue.files', ?, 0, NULL, ?)
        ON CONFLICT(profile_id, capability) DO UPDATE SET
          local_supported = excluded.local_supported,
          remote_supported = 0,
          negotiated_at = NULL,
          updated_at = excluded.updated_at
      `).run(profileId, input.allowRemoteFiles ? 1 : 0, now);
      this.database.prepare(`
        INSERT INTO cloud_connector_capabilities (
          profile_id, capability, local_supported, remote_supported,
          negotiated_at, updated_at
        ) VALUES (?, 'deskcue.control', ?, 0, NULL, ?)
        ON CONFLICT(profile_id, capability) DO UPDATE SET
          local_supported = excluded.local_supported,
          remote_supported = 0,
          negotiated_at = NULL,
          updated_at = excluded.updated_at
      `).run(profileId, input.allowRemoteControl ? 1 : 0, now);
      this.database.prepare(`
        INSERT INTO cloud_connector_capabilities (
          profile_id, capability, local_supported, remote_supported,
          negotiated_at, updated_at
        ) VALUES (?, 'deskcue.preview', ?, 0, NULL, ?)
        ON CONFLICT(profile_id, capability) DO UPDATE SET
          local_supported = excluded.local_supported,
          remote_supported = 0,
          negotiated_at = NULL,
          updated_at = excluded.updated_at
      `).run(profileId, input.allowRemotePreview ? 1 : 0, now);
      if (machineIdentityChanged) {
        this.database.prepare(`
          DELETE FROM cloud_sync_outbox WHERE profile_id = ?
        `).run(profileId);
        this.database.prepare(`
          DELETE FROM cloud_sync_cursors WHERE profile_id = ?
        `).run(profileId);
        this.database.prepare(`
          DELETE FROM cloud_control_receipts WHERE profile_id = ?
        `).run(profileId);
      }
      this.outbox.ensureCursor(profileId, now);
    });
    transaction();
    return this.readActiveProfile()!;
  }

  disconnect() {
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE cloud_connector_profiles
      SET enabled = 0, state = 'disconnected', updated_at = ?
      WHERE enabled = 1
    `).run(now);
  }

  updateSessionLabelDisclosure(profileId: string, enabled: boolean) {
    const now = new Date().toISOString();
    const transaction = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO cloud_connector_capabilities (
          profile_id, capability, local_supported, remote_supported,
          negotiated_at, updated_at
        ) VALUES (?, 'session.labels', ?, 0, NULL, ?)
        ON CONFLICT(profile_id, capability) DO UPDATE SET
          local_supported = excluded.local_supported,
          remote_supported = 0,
          negotiated_at = NULL,
          updated_at = excluded.updated_at
      `).run(profileId, enabled ? 1 : 0, now);
      if (!enabled) this.outbox.redactPendingSessionLabels(profileId);
    });
    transaction();
  }

  updatePermissions(profileId: string, input: UpdateCloudPermissionsInput) {
    const now = new Date().toISOString();
    const capabilities = [
      ["deskcue.read", input.allowRemoteRead],
      ["deskcue.files", input.allowRemoteFiles],
      ["deskcue.control", input.allowRemoteControl],
      ["deskcue.preview", input.allowRemotePreview]
    ] as const;
    const statement = this.database.prepare(`
      INSERT INTO cloud_connector_capabilities (
        profile_id, capability, local_supported, remote_supported,
        negotiated_at, updated_at
      ) VALUES (?, ?, ?, 0, NULL, ?)
      ON CONFLICT(profile_id, capability) DO UPDATE SET
        local_supported = excluded.local_supported,
        remote_supported = 0,
        negotiated_at = NULL,
        updated_at = excluded.updated_at
    `);
    const transaction = this.database.transaction(() => {
      for (const [capability, enabled] of capabilities) {
        statement.run(profileId, capability, enabled ? 1 : 0, now);
      }
    });
    transaction();
  }

  updateState(
    profileId: string,
    state: CloudConnectorState,
    options: {
      errorCode?: string | null;
      connectedAt?: string;
      negotiated?: boolean;
    } = {}
  ) {
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE cloud_connector_profiles SET
        state = ?,
        last_error_code = ?,
        last_connected_at = COALESCE(?, last_connected_at),
        updated_at = ?
      WHERE id = ?
    `).run(
      state,
      options.errorCode ?? null,
      options.connectedAt ?? null,
      now,
      profileId
    );
    if (options.negotiated !== undefined) {
      this.database.prepare(`
        UPDATE cloud_connector_capabilities SET
          remote_supported = ?, negotiated_at = ?, updated_at = ?
        WHERE profile_id = ? AND capability = 'session.summary'
      `).run(options.negotiated ? 1 : 0, options.negotiated ? now : null, now, profileId);
    }
  }

  enqueueSummaries(profileId: string, summaries: CloudRelaySessionSummary[]) {
    return this.outbox.enqueueSummaries(profileId, summaries);
  }

  readLastAckedSequence(profileId: string) {
    return this.outbox.readLastAckedSequence(profileId);
  }

  reconcileServerPosition(profileId: string, nextSequence: number) {
    this.outbox.reconcileServerPosition(profileId, nextSequence);
  }

  readEnvelope(profileId: string, fromSequence: number): CloudRelayEnvelope | null {
    return this.outbox.readEnvelope(profileId, fromSequence);
  }

  markAttempt(profileId: string, messageId: string) {
    this.outbox.markAttempt(profileId, messageId);
  }

  acknowledge(profileId: string, messageId: string, sequence: number) {
    this.outbox.acknowledge(profileId, messageId, sequence);
  }

  reject(profileId: string, messageId: string, errorCode: string, retryable: boolean) {
    this.outbox.reject(profileId, messageId, errorCode, retryable);
  }

  countPending(profileId: string | null) {
    return this.outbox.countPending(profileId);
  }

  reserveControlCommand(input: {
    profileId: string;
    commandId: string;
    operation: string;
    inputSha256: string;
  }): CloudControlReceiptReservation {
    return this.controlReceipts.reserve(input);
  }

  completeControlCommand(input: {
    profileId: string;
    commandId: string;
    status: number;
    body: unknown;
  }) {
    this.controlReceipts.complete(input);
  }

  private readProfile(suffix: string): CloudConnectorProfile | null {
    const profile = this.database.prepare(`
      SELECT profile.id, profile.cloud_origin AS cloudOrigin,
        profile.display_name AS displayName, profile.enabled,
        profile.state, profile.machine_id AS machineId,
        profile.protocol_version AS protocolVersion,
        profile.last_connected_at AS lastConnectedAt,
        profile.last_error_code AS lastErrorCode,
        identity.credential_ref AS credentialRef,
        COALESCE(remote_read.local_supported, 0) AS remoteReadEnabled,
        COALESCE(remote_files.local_supported, 0) AS remoteFilesEnabled,
        COALESCE(remote_control.local_supported, 0) AS remoteControlEnabled,
        COALESCE(remote_preview.local_supported, 0) AS remotePreviewEnabled,
        COALESCE(session_labels.local_supported, 0) AS sessionLabelDisclosureEnabled
      FROM cloud_connector_profiles profile
      JOIN cloud_installation_identity identity ON identity.id = profile.identity_id
      LEFT JOIN cloud_connector_capabilities remote_read
        ON remote_read.profile_id = profile.id AND remote_read.capability = 'deskcue.read'
      LEFT JOIN cloud_connector_capabilities remote_files
        ON remote_files.profile_id = profile.id AND remote_files.capability = 'deskcue.files'
      LEFT JOIN cloud_connector_capabilities remote_control
        ON remote_control.profile_id = profile.id AND remote_control.capability = 'deskcue.control'
      LEFT JOIN cloud_connector_capabilities remote_preview
        ON remote_preview.profile_id = profile.id AND remote_preview.capability = 'deskcue.preview'
      LEFT JOIN cloud_connector_capabilities session_labels
        ON session_labels.profile_id = profile.id AND session_labels.capability = 'session.labels'
      ${suffix}
    `).get() as (Omit<CloudConnectorProfile, "enabled" | "remoteReadEnabled" | "remoteFilesEnabled" | "remoteControlEnabled" | "remotePreviewEnabled" | "sessionLabelDisclosureEnabled"> & {
      enabled: number;
      remoteReadEnabled: number;
      remoteFilesEnabled: number;
      remoteControlEnabled: number;
      remotePreviewEnabled: number;
      sessionLabelDisclosureEnabled: number;
    }) | undefined;
    return profile ? normalizeProfile(profile) : null;
  }
}
