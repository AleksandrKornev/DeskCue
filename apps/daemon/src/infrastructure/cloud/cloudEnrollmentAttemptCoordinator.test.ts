import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { StartCloudEnrollmentAttemptInput } from "@deskcue/protocol/cloud";
import { CloudEnrollmentAttemptRepository } from "#persistence/cloud/cloudEnrollmentAttemptRepository";
import { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";

import { CloudEnrollmentAttemptCoordinator } from "./connector/cloudEnrollmentAttemptCoordinator.ts";
import type { CloudEnrollmentCoordinator } from "./connector/cloudEnrollmentCoordinator.ts";
import { EncryptedFileCloudSecretStore } from "./connector/cloudSecretStore.ts";

function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Timed out waiting for enrollment attempt"));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

test("Cloud enrollment polling resumes after restart and never exposes its secret", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-attempt-resume-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  try {
    context.ensureMigrated();
    const attempts = new CloudEnrollmentAttemptRepository(context.database);
    const secrets = new EncryptedFileCloudSecretStore(directory);
    const credentialRef = "cloud-attempt-test.secret";
    secrets.write(credentialRef, { privateKey: "private-key", machineCredential: "" });
    const enrollment = {
      getOrCreateIdentity: () => ({
        installationId: "installation-test",
        publicKey: "public-key",
        credentialRef
      }),
      getCapabilities: () => ["session.summary"]
    } as unknown as CloudEnrollmentCoordinator;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const first = new CloudEnrollmentAttemptCoordinator({
      attempts,
      enrollment,
      secrets,
      httpClient: {
        createEnrollmentAttempt: async () => ({
          attemptId: "attempt-test",
          attemptSecret: "attempt-secret-placeholder",
          verificationUrl: "https://accounts.example.test/enroll/attempt-test",
          expiresAt,
          pollIntervalMs: 1_000
        }),
        pollEnrollmentAttempt: async () => ({ status: "pending", expiresAt })
      },
      onConnected: async () => undefined
    });
    const response = await first.create({
      cloudOrigin: "https://api.example.test",
      displayName: "Machine",
      allowRemoteRead: false,
      allowRemoteFiles: false,
      allowRemoteControl: false,
      allowRemotePreview: false
    });
    assert.equal(JSON.stringify(response).includes("attempt-secret-placeholder"), false);
    await first.close();
    context.database.prepare(`
      UPDATE cloud_enrollment_attempt SET next_poll_at = ? WHERE id = 1
    `).run(new Date(Date.now() - 1).toISOString());

    const approvedInputs: Array<StartCloudEnrollmentAttemptInput & {
      machineId: string;
      machineCredential: string;
    }> = [];
    const resumed = new CloudEnrollmentAttemptCoordinator({
      attempts,
      enrollment,
      secrets,
      httpClient: {
        createEnrollmentAttempt: async () => {
          throw new Error("unexpected_create");
        },
        pollEnrollmentAttempt: async (_origin, _attemptId, attemptSecret) => {
          assert.equal(attemptSecret, "attempt-secret-placeholder");
          return {
            status: "connected",
            machine: { machineId: "machine-test" },
            machineCredential: "machine-credential-after-approval",
            expiresAt
          };
        }
      },
      onConnected: async (input) => {
        approvedInputs.push(input);
        const secret = secrets.read(credentialRef);
        secrets.write(credentialRef, {
          ...secret,
          machineCredential: "machine-credential-after-approval"
        });
      }
    });
    resumed.start();
    await waitFor(() => approvedInputs.length === 1);
    assert.equal(approvedInputs[0]?.machineId, "machine-test");
    assert.equal(attempts.read(), null);
    assert.equal(secrets.read(credentialRef).enrollmentAttempt, undefined);
    assert.equal(
      secrets.read(credentialRef).machineCredential,
      "machine-credential-after-approval"
    );
    await resumed.close();
  } finally {
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("Cloud enrollment retries connected completion, cancels, and expires durably", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-attempt-lifecycle-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  try {
    context.ensureMigrated();
    const attempts = new CloudEnrollmentAttemptRepository(context.database);
    const secrets = new EncryptedFileCloudSecretStore(directory);
    const credentialRef = "cloud-attempt-lifecycle.secret";
    secrets.write(credentialRef, { privateKey: "private-key", machineCredential: "" });
    const enrollment = {
      getOrCreateIdentity: () => ({
        installationId: "installation-lifecycle",
        publicKey: "public-key",
        credentialRef
      }),
      getCapabilities: () => ["session.summary"]
    } as unknown as CloudEnrollmentCoordinator;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    let completionCount = 0;
    const coordinator = new CloudEnrollmentAttemptCoordinator({
      attempts,
      enrollment,
      secrets,
      httpClient: {
        createEnrollmentAttempt: async () => ({
          attemptId: "attempt-lifecycle",
          attemptSecret: "attempt-secret-placeholder",
          verificationUrl: "https://accounts.example.test/enroll/attempt-lifecycle",
          expiresAt,
          pollIntervalMs: 1_000
        }),
        pollEnrollmentAttempt: async () => ({
          status: "connected",
          machine: { machineId: "machine-lifecycle" },
          machineCredential: "machine-credential-lifecycle",
          expiresAt
        })
      },
      onConnected: async () => {
        completionCount += 1;
        if (completionCount === 1) throw new Error("temporary_completion_failure");
      },
      retryAfterFailureMs: 10
    });
    await coordinator.create({
      cloudOrigin: "https://api.example.test",
      displayName: "Machine",
      allowRemoteRead: false,
      allowRemoteFiles: false,
      allowRemoteControl: false,
      allowRemotePreview: false
    });
    context.database.prepare(`
      UPDATE cloud_enrollment_attempt SET next_poll_at = ? WHERE id = 1
    `).run(new Date(Date.now() - 1).toISOString());
    await coordinator.close();

    const resumed = new CloudEnrollmentAttemptCoordinator({
      attempts,
      enrollment,
      secrets,
      httpClient: {
        createEnrollmentAttempt: async () => {
          throw new Error("unexpected_create");
        },
        pollEnrollmentAttempt: async () => ({
          status: "connected",
          machine: { machineId: "machine-lifecycle" },
          machineCredential: "machine-credential-lifecycle",
          expiresAt
        })
      },
      onConnected: async () => {
        completionCount += 1;
        if (completionCount === 1) throw new Error("temporary_completion_failure");
      },
      retryAfterFailureMs: 10
    });
    resumed.start();
    await waitFor(() => completionCount === 2);
    assert.equal(attempts.read(), null);

    const cancellable = new CloudEnrollmentAttemptCoordinator({
      attempts,
      enrollment,
      secrets,
      httpClient: {
        createEnrollmentAttempt: async () => ({
          attemptId: "attempt-cancel",
          attemptSecret: "attempt-secret-placeholder",
          verificationUrl: "https://accounts.example.test/enroll/attempt-cancel",
          expiresAt,
          pollIntervalMs: 1_000
        }),
        pollEnrollmentAttempt: async () => ({ status: "pending", expiresAt })
      },
      onConnected: async () => undefined
    });
    await cancellable.create({
      cloudOrigin: "https://api.example.test",
      displayName: "Machine",
      allowRemoteRead: false,
      allowRemoteFiles: false,
      allowRemoteControl: false,
      allowRemotePreview: false
    });
    cancellable.cancel();
    assert.equal(attempts.read(), null);
    assert.equal(secrets.read(credentialRef).enrollmentAttempt, undefined);
    await cancellable.close();

    secrets.write(credentialRef, {
      ...secrets.read(credentialRef),
      enrollmentAttempt: {
        attemptId: "attempt-expired",
        attemptSecret: "attempt-secret-placeholder",
        verificationUrl: "https://accounts.example.test/enroll/attempt-expired"
      }
    });
    attempts.replace({
      attemptId: "attempt-expired",
      cloudOrigin: "https://api.example.test",
      displayName: "Machine",
      credentialRef,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      nextPollAt: new Date(Date.now() - 2_000).toISOString(),
      pollIntervalMs: 1_000,
      status: "pending",
      lastErrorCode: null,
      allowRemoteRead: false,
      allowRemoteFiles: false,
      allowRemoteControl: false,
      allowRemotePreview: false
    });
    const expired = new CloudEnrollmentAttemptCoordinator({
      attempts,
      enrollment,
      secrets,
      httpClient: {
        createEnrollmentAttempt: async () => {
          throw new Error("unexpected_create");
        },
        pollEnrollmentAttempt: async () => {
          throw new Error("unexpected_poll");
        }
      },
      onConnected: async () => undefined
    });
    expired.start();
    assert.equal(attempts.read(), null);
    assert.equal(secrets.read(credentialRef).enrollmentAttempt, undefined);
    await expired.close();
    await resumed.close();
  } finally {
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("cancelling an in-flight poll cannot connect the stale machine", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cloud-attempt-race-"));
  const context = new SqliteDatabaseContext(join(directory, "deskcue.sqlite"));
  try {
    context.ensureMigrated();
    const attempts = new CloudEnrollmentAttemptRepository(context.database);
    const secrets = new EncryptedFileCloudSecretStore(directory);
    const credentialRef = "cloud-attempt-race.secret";
    secrets.write(credentialRef, {
      privateKey: "private-key",
      machineCredential: "",
      enrollmentAttempt: {
        attemptId: "attempt-race",
        attemptSecret: "attempt-secret-placeholder",
        verificationUrl: "https://accounts.example.test/enroll/attempt-race"
      }
    });
    attempts.replace({
      attemptId: "attempt-race",
      cloudOrigin: "https://api.example.test",
      displayName: "Machine",
      credentialRef,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      nextPollAt: new Date(Date.now() - 1).toISOString(),
      pollIntervalMs: 1_000,
      status: "pending",
      lastErrorCode: null,
      allowRemoteRead: false,
      allowRemoteFiles: false,
      allowRemoteControl: false,
      allowRemotePreview: false
    });
    let resolvePoll!: (value: {
      status: "connected";
      machine: { machineId: string };
      machineCredential: string;
      expiresAt: string;
    }) => void;
    let pollStarted = false;
    let connectionCount = 0;
    const coordinator = new CloudEnrollmentAttemptCoordinator({
      attempts,
      enrollment: {
        getOrCreateIdentity: () => ({
          installationId: "installation-race",
          publicKey: "public-key",
          credentialRef
        }),
        getCapabilities: () => ["session.summary"]
      } as unknown as CloudEnrollmentCoordinator,
      secrets,
      httpClient: {
        createEnrollmentAttempt: async () => {
          throw new Error("unexpected_create");
        },
        pollEnrollmentAttempt: async () => {
          pollStarted = true;
          return new Promise((resolve) => {
            resolvePoll = resolve;
          });
        }
      },
      onConnected: async () => {
        connectionCount += 1;
      }
    });
    coordinator.start();
    await waitFor(() => pollStarted);
    coordinator.cancel();
    resolvePoll({
      status: "connected",
      machine: { machineId: "machine-stale" },
      machineCredential: "machine-credential-stale",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(connectionCount, 0);
    assert.equal(attempts.read(), null);
    await coordinator.close();
  } finally {
    context.close();
    await rm(directory, { force: true, recursive: true });
  }
});
