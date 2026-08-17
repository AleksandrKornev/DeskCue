import { generateKeyPairSync, randomUUID } from "node:crypto";

import {
  CLOUD_RELAY_CAPABILITY,
  CLOUD_REMOTE_CONTROL_CAPABILITY,
  CLOUD_REMOTE_FILES_CAPABILITY,
  CLOUD_REMOTE_PREVIEW_CAPABILITY,
  CLOUD_REMOTE_READ_CAPABILITY,
  CLOUD_REMOTE_REALTIME_CAPABILITY
} from "@deskcue/protocol/cloud";
import type {
  CloudConnectionStatusResponse,
  ConnectCloudInput,
  UpdateCloudPermissionsInput
} from "@deskcue/protocol/cloud";
import type {
  CloudConnectorProfile,
  CloudInstallationIdentity
} from "#persistence/cloud/cloudConnectorStore";

import type { CloudConnectorHttpClient } from "./cloudConnectorHttpClient.ts";
import type { CloudMachineSecret } from "./cloudSecretStore.ts";

type CloudEnrollmentProfileInput = {
  cloudOrigin: string;
  displayName: string;
  machineId: string;
  allowRemoteRead: boolean;
  allowRemoteFiles: boolean;
  allowRemoteControl: boolean;
  allowRemotePreview: boolean;
};

export type CloudEnrollmentStore = {
  readIdentity: () => CloudInstallationIdentity | null;
  createIdentity: (identity: CloudInstallationIdentity) => void;
  updateIdentityPublicKey: (publicKey: string) => void;
  readActiveProfile: () => CloudConnectorProfile | null;
  readLatestProfile: () => CloudConnectorProfile | null;
  enrollProfile: (input: CloudEnrollmentProfileInput) => CloudConnectorProfile;
  disconnect: () => void;
  countPending: (profileId: string | null) => number;
};

export type CloudCredentialStore = {
  read: (reference: string) => CloudMachineSecret;
  write: (reference: string, secret: CloudMachineSecret) => void;
  remove: (reference: string) => void;
};

export type CloudEnrollmentHttpClient = Pick<
  CloudConnectorHttpClient,
  "enroll" | "createConnectionToken" | "replaceCapabilities"
>;

type CloudEnrollmentLifecycle = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

type CompleteCloudEnrollmentInput = Omit<ConnectCloudInput, "enrollmentTicket"> & {
  machineId: string;
  machineCredential: string;
};

type CloudEnrollmentCoordinatorOptions = {
  daemonVersion: string;
  store: CloudEnrollmentStore;
  secrets: CloudCredentialStore;
  httpClient: CloudEnrollmentHttpClient;
};

function generateIdentityKeyPair() {
  const keyPair = generateKeyPairSync("ed25519");
  return {
    publicKey: keyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}

function buildCloudCapabilities(input: Omit<ConnectCloudInput, "cloudOrigin" | "displayName" | "enrollmentTicket">) {
  return [
    CLOUD_RELAY_CAPABILITY,
    ...(input.allowRemoteRead ? [CLOUD_REMOTE_READ_CAPABILITY] : []),
    ...(input.allowRemoteRead ? [CLOUD_REMOTE_REALTIME_CAPABILITY] : []),
    ...(input.allowRemoteFiles ? [CLOUD_REMOTE_FILES_CAPABILITY] : []),
    ...(input.allowRemoteControl ? [CLOUD_REMOTE_CONTROL_CAPABILITY] : []),
    ...(input.allowRemotePreview ? [CLOUD_REMOTE_PREVIEW_CAPABILITY] : [])
  ];
}

/** Owns installation identity, enrollment, and the local Cloud credential lifecycle. */
export class CloudEnrollmentCoordinator {
  constructor(private readonly options: CloudEnrollmentCoordinatorOptions) {}

  async enroll(input: ConnectCloudInput, lifecycle: CloudEnrollmentLifecycle) {
    this.options.store.disconnect();
    const { identity, privateKey } = this.ensureIdentity();
    const enrollment = await this.options.httpClient.enroll(
      input.cloudOrigin,
      {
        enrollmentTicket: input.enrollmentTicket,
        installationId: identity.installationId,
        displayName: input.displayName,
        localDaemonVersion: this.options.daemonVersion,
        capabilities: buildCloudCapabilities(input)
      },
      lifecycle.signal
    );
    if (!lifecycle.isCurrent()) throw new Error("enrollment_cancelled");
    return this.commit({
      ...input,
      machineId: enrollment.machine.machineId,
      machineCredential: enrollment.machineCredential
    }, { identity, privateKey });
  }

  completeAttempt(input: CompleteCloudEnrollmentInput) {
    return this.commit(input, this.ensureIdentity());
  }

  getOrCreateIdentity() {
    return this.ensureIdentity().identity;
  }

  getCapabilities(input: Omit<ConnectCloudInput, "cloudOrigin" | "displayName" | "enrollmentTicket">) {
    return buildCloudCapabilities(input);
  }

  disconnect() {
    const profile = this.options.store.readActiveProfile();
    this.options.store.disconnect();
    if (!profile) return;
    try {
      const secret = this.options.secrets.read(profile.credentialRef);
      this.options.secrets.write(profile.credentialRef, {
        ...secret,
        machineCredential: ""
      });
    } catch {
      this.options.secrets.remove(profile.credentialRef);
    }
  }

  createConnectionToken(profile: CloudConnectorProfile, lifecycleSignal: AbortSignal) {
    const secret = this.options.secrets.read(profile.credentialRef);
    if (!secret.machineCredential) throw new Error("Cloud machine credential is unavailable.");
    if (!profile.machineId) throw new Error("Cloud machine identity is unavailable.");
    return this.options.httpClient.createConnectionToken(
      profile.cloudOrigin,
      profile.machineId,
      secret.machineCredential,
      lifecycleSignal
    );
  }

  replaceCapabilities(
    profile: CloudConnectorProfile,
    input: UpdateCloudPermissionsInput,
    lifecycleSignal: AbortSignal
  ) {
    const secret = this.options.secrets.read(profile.credentialRef);
    if (!secret.machineCredential) throw new Error("Cloud machine credential is unavailable.");
    if (!profile.machineId) throw new Error("Cloud machine identity is unavailable.");
    return this.options.httpClient.replaceCapabilities(
      profile.cloudOrigin,
      profile.machineId,
      secret.machineCredential,
      buildCloudCapabilities(input),
      lifecycleSignal
    );
  }

  getStatus(relayConnected: boolean): CloudConnectionStatusResponse {
    const profile = this.options.store.readActiveProfile() ??
      this.options.store.readLatestProfile();
    return {
      connectorIncluded: true,
      connected: profile?.state === "connected" && relayConnected,
      enabled: profile?.enabled ?? false,
      state: profile?.state ?? "disconnected",
      cloudOrigin: profile?.cloudOrigin ?? null,
      displayName: profile?.displayName ?? null,
      machineId: profile?.machineId ?? null,
      lastConnectedAt: profile?.lastConnectedAt ?? null,
      lastErrorCode: profile?.lastErrorCode ?? null,
      pendingEventCount: this.options.store.countPending(profile?.id ?? null),
      remoteReadEnabled: profile?.remoteReadEnabled ?? false,
      remoteFilesEnabled: profile?.remoteFilesEnabled ?? false,
      remoteControlEnabled: profile?.remoteControlEnabled ?? false,
      remotePreviewEnabled: profile?.remotePreviewEnabled ?? false,
      sessionLabelDisclosureEnabled: profile?.sessionLabelDisclosureEnabled ?? false
    };
  }

  private ensureIdentity(): { identity: CloudInstallationIdentity; privateKey: string } {
    const existing = this.options.store.readIdentity();
    if (existing) {
      try {
        return {
          identity: existing,
          privateKey: this.options.secrets.read(existing.credentialRef).privateKey
        };
      } catch {
        const generated = generateIdentityKeyPair();
        this.options.store.updateIdentityPublicKey(generated.publicKey);
        this.options.secrets.write(existing.credentialRef, {
          privateKey: generated.privateKey,
          machineCredential: ""
        });
        return {
          identity: { ...existing, publicKey: generated.publicKey },
          privateKey: generated.privateKey
        };
      }
    }
    const installationId = `inst_${randomUUID()}`;
    const credentialRef = `cloud-${installationId.slice(5)}.secret`;
    const generated = generateIdentityKeyPair();
    const identity: CloudInstallationIdentity = {
      installationId,
      publicKey: generated.publicKey,
      credentialRef
    };
    this.options.secrets.write(credentialRef, {
      privateKey: generated.privateKey,
      machineCredential: ""
    });
    this.options.store.createIdentity(identity);
    return { identity, privateKey: generated.privateKey };
  }

  private commit(
    input: CompleteCloudEnrollmentInput,
    identitySecret: { identity: CloudInstallationIdentity; privateKey: string }
  ) {
    this.options.secrets.write(identitySecret.identity.credentialRef, {
      privateKey: identitySecret.privateKey,
      machineCredential: input.machineCredential
    });
    return this.options.store.enrollProfile({
      cloudOrigin: input.cloudOrigin,
      displayName: input.displayName,
      machineId: input.machineId,
      allowRemoteRead: input.allowRemoteRead,
      allowRemoteFiles: input.allowRemoteFiles,
      allowRemoteControl: input.allowRemoteControl,
      allowRemotePreview: input.allowRemotePreview
    });
  }
}
