import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOUD_RELAY_CAPABILITY,
  CLOUD_REMOTE_CONTROL_CAPABILITY,
  CLOUD_REMOTE_FILES_CAPABILITY,
  CLOUD_REMOTE_PREVIEW_CAPABILITY,
  CLOUD_REMOTE_READ_CAPABILITY,
  CLOUD_REMOTE_REALTIME_CAPABILITY
} from "@deskcue/protocol";
import type {
  CloudConnectorProfile,
  CloudInstallationIdentity
} from "#persistence/cloud/cloudConnectorStore";

import { CloudEnrollmentCoordinator } from "./connector/cloudEnrollmentCoordinator.ts";
import type {
  CloudCredentialStore,
  CloudEnrollmentHttpClient,
  CloudEnrollmentStore
} from "./connector/cloudEnrollmentCoordinator.ts";

class MemoryCredentialStore implements CloudCredentialStore {
  readonly unreadable = new Set<string>();
  readonly removed: string[] = [];
  private readonly values = new Map<string, Parameters<CloudCredentialStore["write"]>[1]>();

  read(reference: string) {
    if (this.unreadable.has(reference)) throw new Error("credential unavailable");
    const secret = this.values.get(reference);
    if (!secret) throw new Error("credential unavailable");
    return secret;
  }

  write(reference: string, secret: Parameters<CloudCredentialStore["write"]>[1]) {
    this.unreadable.delete(reference);
    this.values.set(reference, secret);
  }

  remove(reference: string) {
    this.removed.push(reference);
    this.unreadable.delete(reference);
    this.values.delete(reference);
  }
}

function connectInput() {
  return {
    cloudOrigin: "https://cloud.example.test",
    displayName: "Test machine",
    enrollmentTicket: "ticket-placeholder",
    allowRemoteRead: true,
    allowRemoteFiles: true,
    allowRemoteControl: true,
    allowRemotePreview: true
  };
}

function profile(
  credentialRef: string,
  input: Partial<Parameters<CloudEnrollmentStore["enrollProfile"]>[0]> = {}
): CloudConnectorProfile {
  return {
    id: "profile-1",
    cloudOrigin: input.cloudOrigin ?? "https://cloud.example.test",
    displayName: input.displayName ?? "Test machine",
    enabled: true,
    state: "connecting",
    machineId: input.machineId ?? "machine-test",
    protocolVersion: 1,
    lastConnectedAt: null,
    lastErrorCode: null,
    credentialRef,
    remoteReadEnabled: input.allowRemoteRead ?? true,
    remoteFilesEnabled: input.allowRemoteFiles ?? true,
    remoteControlEnabled: input.allowRemoteControl ?? true,
    remotePreviewEnabled: input.allowRemotePreview ?? true,
    sessionLabelDisclosureEnabled: false
  };
}

class MemoryEnrollmentStore implements CloudEnrollmentStore {
  identity: CloudInstallationIdentity | null = null;
  activeProfile: CloudConnectorProfile | null = null;
  latestProfile: CloudConnectorProfile | null = null;
  disconnectCalls = 0;
  readonly updatedPublicKeys: string[] = [];
  readonly enrollInputs: Array<Parameters<CloudEnrollmentStore["enrollProfile"]>[0]> = [];

  readIdentity() {
    return this.identity;
  }

  createIdentity(identity: CloudInstallationIdentity) {
    this.identity = identity;
  }

  updateIdentityPublicKey(publicKey: string) {
    this.updatedPublicKeys.push(publicKey);
    if (this.identity) this.identity = { ...this.identity, publicKey };
  }

  readActiveProfile() {
    return this.activeProfile;
  }

  readLatestProfile() {
    return this.latestProfile;
  }

  enrollProfile(input: Parameters<CloudEnrollmentStore["enrollProfile"]>[0]) {
    this.enrollInputs.push(input);
    const enrolled = profile(this.identity?.credentialRef ?? "cloud-missing.secret", input);
    this.activeProfile = enrolled;
    this.latestProfile = enrolled;
    return enrolled;
  }

  disconnect() {
    this.disconnectCalls += 1;
    if (this.activeProfile) {
      this.latestProfile = {
        ...this.activeProfile,
        enabled: false,
        state: "disconnected"
      };
    }
    this.activeProfile = null;
  }

  countPending() {
    return 0;
  }
}

function connectionToken() {
  return {
    connectionToken: "connection-token-placeholder",
    relayUrl: "wss://cloud.example.test/relay/machines/machine-test",
    expiresAt: "2026-08-11T12:00:00.000Z",
    cursors: { "session.summary": 0 }
  };
}

test("Cloud enrollment owns identity, credentials, capabilities, and token issuance", async () => {
  const store = new MemoryEnrollmentStore();
  const secrets = new MemoryCredentialStore();
  const controller = new AbortController();
  const enrollmentRequests: Array<Parameters<CloudEnrollmentHttpClient["enroll"]>[1]> = [];
  let tokenCredential: string | null = null;
  let replacedCapabilities: string[] | null = null;
  const coordinator = new CloudEnrollmentCoordinator({
    daemonVersion: "test-version",
    store,
    secrets,
    httpClient: {
      enroll: async (_origin, request, signal) => {
        enrollmentRequests.push(request);
        assert.equal(signal, controller.signal);
        return {
          machine: { machineId: "machine-test" },
          machineCredential: "machine-credential-placeholder"
        };
      },
      createConnectionToken: async (_origin, _machineId, credential, signal) => {
        tokenCredential = credential;
        assert.equal(signal, controller.signal);
        return connectionToken();
      },
      replaceCapabilities: async (_origin, _machineId, credential, capabilities, signal) => {
        tokenCredential = credential;
        replacedCapabilities = capabilities;
        assert.equal(signal, controller.signal);
      }
    }
  });

  const profile = await coordinator.enroll(connectInput(), {
    signal: controller.signal,
    isCurrent: () => true
  });

  assert.equal(store.disconnectCalls, 1);
  assert.match(store.identity?.installationId ?? "", /^inst_/);
  assert.match(store.identity?.publicKey ?? "", /BEGIN PUBLIC KEY/);
  const enrollmentRequest = enrollmentRequests[0];
  assert.ok(enrollmentRequest);
  assert.deepEqual(enrollmentRequest.capabilities, [
    CLOUD_RELAY_CAPABILITY,
    CLOUD_REMOTE_READ_CAPABILITY,
    CLOUD_REMOTE_REALTIME_CAPABILITY,
    CLOUD_REMOTE_FILES_CAPABILITY,
    CLOUD_REMOTE_CONTROL_CAPABILITY,
    CLOUD_REMOTE_PREVIEW_CAPABILITY
  ]);
  assert.equal(enrollmentRequest.localDaemonVersion, "test-version");
  assert.equal(secrets.read(profile.credentialRef).machineCredential, "machine-credential-placeholder");

  assert.deepEqual(
    await coordinator.createConnectionToken(profile, controller.signal),
    connectionToken()
  );
  assert.equal(tokenCredential, "machine-credential-placeholder");

  await coordinator.replaceCapabilities(profile, {
    allowRemoteRead: false,
    allowRemoteFiles: true,
    allowRemoteControl: false,
    allowRemotePreview: true
  }, controller.signal);
  assert.deepEqual(replacedCapabilities, [
    CLOUD_RELAY_CAPABILITY,
    CLOUD_REMOTE_FILES_CAPABILITY,
    CLOUD_REMOTE_PREVIEW_CAPABILITY
  ]);
  assert.equal(tokenCredential, "machine-credential-placeholder");

  coordinator.disconnect();
  assert.equal(store.activeProfile, null);
  assert.equal(secrets.read(profile.credentialRef).machineCredential, "");
});

test("Cloud enrollment rotates an unreadable identity and rejects stale commits", async () => {
  const store = new MemoryEnrollmentStore();
  store.identity = {
    installationId: "inst_existing",
    publicKey: "stale-public-key",
    credentialRef: "cloud-existing.secret"
  };
  const secrets = new MemoryCredentialStore();
  secrets.unreadable.add(store.identity.credentialRef);
  const coordinator = new CloudEnrollmentCoordinator({
    daemonVersion: "test-version",
    store,
    secrets,
    httpClient: {
      enroll: async () => ({
        machine: { machineId: "stale-machine" },
        machineCredential: "stale-machine-credential-placeholder"
      }),
      createConnectionToken: async () => connectionToken(),
      replaceCapabilities: async () => undefined
    }
  });

  await assert.rejects(
    coordinator.enroll(connectInput(), {
      signal: new AbortController().signal,
      isCurrent: () => false
    }),
    /enrollment_cancelled/
  );

  assert.equal(store.enrollInputs.length, 0);
  assert.equal(store.updatedPublicKeys.length, 1);
  assert.notEqual(store.updatedPublicKeys[0], "stale-public-key");
  assert.equal(secrets.read(store.identity.credentialRef).machineCredential, "");

  store.activeProfile = profile(store.identity.credentialRef);
  store.latestProfile = store.activeProfile;
  secrets.unreadable.add(store.identity.credentialRef);
  coordinator.disconnect();
  assert.deepEqual(secrets.removed, [store.identity.credentialRef]);
});
