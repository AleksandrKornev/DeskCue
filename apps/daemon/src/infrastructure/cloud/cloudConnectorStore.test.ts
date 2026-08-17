import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteCloudConnectorStore } from "#persistence/cloud/cloudConnectorStore";
import { CloudEnrollmentAttemptRepository } from "#persistence/cloud/cloudEnrollmentAttemptRepository";
import { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";

import { EncryptedFileCloudSecretStore } from "./connector/cloudSecretStore.ts";

test("cloud credential envelope never stores the machine credential as plaintext", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-secret-"));
  try {
    const secrets = new EncryptedFileCloudSecretStore(directory);
    const reference = "cloud-test.secret";
    const machineCredential = "machine-credential-test-value";
    secrets.write(reference, { machineCredential, privateKey: "private-key-test-value" });

    assert.deepEqual(secrets.read(reference), {
      machineCredential,
      privateKey: "private-key-test-value"
    });
    for (const fileName of await readdir(join(directory, "cloud-secrets"))) {
      const bytes = await readFile(join(directory, "cloud-secrets", fileName));
      assert.equal(bytes.includes(Buffer.from(machineCredential)), false);
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("cloud enrollment attempt persists restart metadata without its secret", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-attempt-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  try {
    context.ensureMigrated();
    const attempts = new CloudEnrollmentAttemptRepository(context.database);
    attempts.replace({
      attemptId: "attempt-test",
      cloudOrigin: "https://cloud.example.test",
      displayName: "Machine",
      credentialRef: "cloud-test.secret",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      nextPollAt: new Date(Date.now() + 1_000).toISOString(),
      pollIntervalMs: 1_000,
      status: "pending",
      lastErrorCode: null,
      allowRemoteRead: true,
      allowRemoteFiles: true,
      allowRemoteControl: false,
      allowRemotePreview: true
    });
    assert.equal(attempts.read()?.attemptId, "attempt-test");
    const serialized = JSON.stringify(
      context.database.prepare("SELECT * FROM cloud_enrollment_attempt").get()
    );
    assert.equal(serialized.includes("attempt-secret-placeholder"), false);
    assert.equal(serialized.includes("enrollmentTicket"), false);
  } finally {
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("cloud outbox keeps a stable envelope until the server acknowledges it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-outbox-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  try {
    const store = new SqliteCloudConnectorStore(context);
    store.createIdentity({
      installationId: "inst_test",
      publicKey: "public-key",
      credentialRef: "cloud-test.secret"
    });
    const profile = store.enrollProfile({
      cloudOrigin: "https://cloud.example.test",
      displayName: "Test machine",
      machineId: "mach_test",
      allowRemoteRead: false,
      allowRemoteFiles: false,
      allowRemoteControl: false
    });
    assert.equal(profile.remoteReadEnabled, false);
    assert.equal(profile.remoteFilesEnabled, false);
    const optedInProfile = store.enrollProfile({
      cloudOrigin: "https://cloud.example.test",
      displayName: "Test machine",
      machineId: "mach_test",
      allowRemoteRead: true,
      allowRemoteFiles: true,
      allowRemoteControl: true
    });
    assert.equal(optedInProfile.id, profile.id);
    assert.equal(optedInProfile.remoteReadEnabled, true);
    assert.equal(optedInProfile.remoteFilesEnabled, true);
    assert.equal(optedInProfile.remoteControlEnabled, true);
    store.enqueueSummaries(profile.id, [{
      sessionId: "sess_opaque",
      runtime: "codex",
      status: "running",
      replyState: "waiting_for_agent",
      updatedAt: "2026-08-09T10:00:00.000Z",
      disclosureScope: "metadata_only"
    }]);
    context.database.prepare(`
      UPDATE cloud_sync_outbox
      SET payload_json = json_remove(payload_json, '$.summary.disclosureScope')
      WHERE profile_id = ?
    `).run(profile.id);

    const first = store.readEnvelope(profile.id, 1);
    const replay = store.readEnvelope(profile.id, 1);
    assert.deepEqual(replay, first);
    assert.equal(first?.payload.summary.disclosureScope, "metadata_only");
    assert.equal(first?.sequence, 1);
    assert.equal(store.countPending(profile.id), 1);
    assert.throws(
      () => store.reconcileServerPosition(profile.id, 3),
      /outside the durable outbox/
    );

    store.acknowledge(profile.id, first!.messageId, 1);
    assert.equal(store.countPending(profile.id), 0);
    assert.equal(store.readLastAckedSequence(profile.id), 1);
  } finally {
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("cloud session label disclosure is opt-in and redacts pending outbox labels when disabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-disclosure-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  try {
    const store = new SqliteCloudConnectorStore(context);
    store.createIdentity({
      installationId: "inst_disclosure",
      publicKey: "public-key",
      credentialRef: "cloud-test.secret"
    });
    const profile = store.enrollProfile({
      cloudOrigin: "https://cloud.example.test",
      displayName: "Test machine",
      machineId: "mach_disclosure",
      allowRemoteRead: false,
      allowRemoteControl: false
    });
    assert.equal(profile.sessionLabelDisclosureEnabled, false);

    store.updateSessionLabelDisclosure(profile.id, true);
    assert.equal(store.readActiveProfile()?.sessionLabelDisclosureEnabled, true);
    store.enqueueSummaries(profile.id, [{
      sessionId: "sess_disclosure",
      runtime: "codex",
      status: "running",
      replyState: "waiting_for_agent",
      updatedAt: "2026-08-09T10:00:00.000Z",
      disclosureScope: "user_opt_in",
      displayLabel: "Private session label",
      workspaceLabel: "Private workspace"
    }]);

    store.updateSessionLabelDisclosure(profile.id, false);
    assert.equal(store.readActiveProfile()?.sessionLabelDisclosureEnabled, false);
    assert.deepEqual(store.readEnvelope(profile.id, 1)?.payload.summary, {
      sessionId: "sess_disclosure",
      runtime: "codex",
      status: "running",
      replyState: "waiting_for_agent",
      updatedAt: "2026-08-09T10:00:00.000Z",
      disclosureScope: "metadata_only"
    });
    store.enqueueSummaries(profile.id, [{
      sessionId: "sess_disclosure",
      runtime: "codex",
      status: "running",
      replyState: "waiting_for_agent",
      updatedAt: "2026-08-09T10:00:00.000Z",
      disclosureScope: "metadata_only"
    }]);
    assert.equal(store.countPending(profile.id), 2);
    assert.equal(store.readEnvelope(profile.id, 2)?.sequence, 2);
  } finally {
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("cloud outbox keeps a nonretryable rejection at the head of its contiguous stream", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-outbox-rejected-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  try {
    const store = new SqliteCloudConnectorStore(context);
    store.createIdentity({
      installationId: "inst_rejected",
      publicKey: "public-key",
      credentialRef: "cloud-test.secret"
    });
    const profile = store.enrollProfile({
      cloudOrigin: "https://cloud.example.test",
      displayName: "Test machine",
      machineId: "mach_rejected",
      allowRemoteRead: false,
      allowRemoteControl: false
    });
    store.enqueueSummaries(profile.id, [
      {
        sessionId: "sess_first",
        runtime: "codex",
        status: "running",
        replyState: "waiting_for_agent",
        updatedAt: "2026-08-09T10:00:00.000Z",
        disclosureScope: "metadata_only"
      },
      {
        sessionId: "sess_second",
        runtime: "claude_code",
        status: "running",
        replyState: "waiting_for_agent",
        updatedAt: "2026-08-09T10:00:01.000Z",
        disclosureScope: "metadata_only"
      }
    ]);

    const first = store.readEnvelope(profile.id, 1);
    assert.equal(first?.sequence, 1);
    store.reject(profile.id, first!.messageId, "INVALID_PAYLOAD", false);

    assert.deepEqual(store.readEnvelope(profile.id, 1), first);
    assert.equal(store.countPending(profile.id), 2);
    assert.deepEqual(
      context.database.prepare(`
        SELECT last_error_code AS lastErrorCode, dead_lettered_at AS deadLetteredAt
        FROM cloud_sync_outbox WHERE id = ?
      `).get(first!.messageId),
      { lastErrorCode: "INVALID_PAYLOAD", deadLetteredAt: null }
    );
  } finally {
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("cloud outbox resets when enrollment changes the remote machine identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-reenroll-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  try {
    const store = new SqliteCloudConnectorStore(context);
    store.createIdentity({
      installationId: "inst_test",
      publicKey: "public-key",
      credentialRef: "cloud-test.secret"
    });
    const original = store.enrollProfile({
      cloudOrigin: "https://cloud.example.test",
      displayName: "Test machine",
      machineId: "mach_original",
      allowRemoteRead: true,
      allowRemoteControl: false
    });
    store.enqueueSummaries(original.id, [{
      sessionId: "sess_original",
      runtime: "codex",
      status: "running",
      replyState: "waiting_for_agent",
      updatedAt: "2026-08-09T10:00:00.000Z",
      disclosureScope: "metadata_only"
    }]);
    assert.equal(store.countPending(original.id), 1);
    const command = {
      profileId: original.id,
      commandId: "cmd_before_reenroll",
      operation: "managed.interrupt",
      inputSha256: "d".repeat(64)
    };
    assert.deepEqual(store.reserveControlCommand(command), { kind: "reserved" });

    const replacement = store.enrollProfile({
      cloudOrigin: "https://cloud.example.test",
      displayName: "Test machine",
      machineId: "mach_replacement",
      allowRemoteRead: true,
      allowRemoteControl: false
    });

    assert.equal(replacement.id, original.id);
    assert.equal(store.countPending(replacement.id), 0);
    assert.equal(store.readLastAckedSequence(replacement.id), 0);
    assert.equal(store.readEnvelope(replacement.id, 1), null);
    assert.deepEqual(store.reserveControlCommand(command), { kind: "reserved" });
  } finally {
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("cloud permission replacement persists one complete unnegotiated grant set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-permissions-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  try {
    const store = new SqliteCloudConnectorStore(context);
    store.createIdentity({
      installationId: "inst_permissions",
      publicKey: "public-key",
      credentialRef: "cloud-test.secret"
    });
    const profile = store.enrollProfile({
      cloudOrigin: "https://cloud.example.test",
      displayName: "Permissions machine",
      machineId: "mach_permissions",
      allowRemoteRead: true,
      allowRemoteFiles: false,
      allowRemoteControl: true,
      allowRemotePreview: false
    });
    context.database.prepare(`
      UPDATE cloud_connector_capabilities
      SET remote_supported = 1, negotiated_at = ?
      WHERE profile_id = ?
    `).run(new Date().toISOString(), profile.id);

    store.updatePermissions(profile.id, {
      allowRemoteRead: false,
      allowRemoteFiles: true,
      allowRemoteControl: false,
      allowRemotePreview: true
    });

    assert.deepEqual(store.readActiveProfile(), {
      ...profile,
      remoteReadEnabled: false,
      remoteFilesEnabled: true,
      remoteControlEnabled: false,
      remotePreviewEnabled: true
    });
    const rows = context.database.prepare(`
      SELECT capability, local_supported AS localSupported,
        remote_supported AS remoteSupported, negotiated_at AS negotiatedAt
      FROM cloud_connector_capabilities
      WHERE profile_id = ? AND capability LIKE 'deskcue.%'
      ORDER BY capability
    `).all(profile.id);
    assert.deepEqual(rows, [
      { capability: "deskcue.control", localSupported: 0, remoteSupported: 0, negotiatedAt: null },
      { capability: "deskcue.files", localSupported: 1, remoteSupported: 0, negotiatedAt: null },
      { capability: "deskcue.preview", localSupported: 1, remoteSupported: 0, negotiatedAt: null },
      { capability: "deskcue.read", localSupported: 0, remoteSupported: 0, negotiatedAt: null }
    ]);
  } finally {
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("cloud control receipts bind an id to the operation and input digest durably", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-control-receipt-"));
  const databasePath = join(directory, "deskcue.sqlite");
  let context = new SqliteDatabaseContext(databasePath);
  try {
    let store = new SqliteCloudConnectorStore(context);
    store.createIdentity({
      installationId: "inst_control",
      publicKey: "public-key",
      credentialRef: "cloud-test.secret"
    });
    const profile = store.enrollProfile({
      cloudOrigin: "https://cloud.example.test",
      displayName: "Test machine",
      machineId: "mach_control",
      allowRemoteRead: true,
      allowRemoteControl: true
    });
    const reservation = {
      profileId: profile.id,
      commandId: "cmd_stable_123",
      operation: "managed.input",
      inputSha256: "a".repeat(64)
    };
    assert.deepEqual(store.reserveControlCommand(reservation), { kind: "reserved" });
    assert.deepEqual(store.reserveControlCommand(reservation), { kind: "ambiguous" });

    context.close();
    context = new SqliteDatabaseContext(databasePath);
    store = new SqliteCloudConnectorStore(context);
    assert.deepEqual(store.reserveControlCommand(reservation), { kind: "ambiguous" });
    store.completeControlCommand({
      profileId: profile.id,
      commandId: reservation.commandId,
      status: 200,
      body: { accepted: true }
    });
    assert.deepEqual(store.reserveControlCommand(reservation), {
      kind: "replay",
      status: 200,
      body: { accepted: true }
    });
    assert.deepEqual(store.reserveControlCommand({
      ...reservation,
      inputSha256: "b".repeat(64)
    }), { kind: "conflict" });
  } finally {
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("cloud control receipt stores no command input or prompt plaintext", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-control-private-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  try {
    const store = new SqliteCloudConnectorStore(context);
    store.createIdentity({
      installationId: "inst_private",
      publicKey: "public-key",
      credentialRef: "cloud-test.secret"
    });
    const profile = store.enrollProfile({
      cloudOrigin: "https://cloud.example.test",
      displayName: "Test machine",
      machineId: "mach_private",
      allowRemoteRead: true,
      allowRemoteControl: true
    });
    const privatePrompt = "never persist this prompt body";
    store.reserveControlCommand({
      profileId: profile.id,
      commandId: "cmd_private_123",
      operation: "managed.input",
      inputSha256: "c".repeat(64)
    });
    const rows = context.database.prepare("SELECT * FROM cloud_control_receipts").all();
    assert.equal(JSON.stringify(rows).includes(privatePrompt), false);
    assert.equal(
      context.database.prepare("PRAGMA table_info(cloud_control_receipts)").all()
        .some((column) => (column as { name: string }).name.includes("body")),
      false
    );
  } finally {
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});
