import type { CloudEnrollmentAttemptResponse, StartCloudEnrollmentAttemptInput } from "@deskcue/protocol/cloud";
import type {
  CloudEnrollmentAttemptRecord,
  CloudEnrollmentAttemptRepository
} from "#persistence/cloud/cloudEnrollmentAttemptRepository";

import type { CloudConnectorHttpClient } from "./cloudConnectorHttpClient.ts";
import type { CloudEnrollmentCoordinator, CloudCredentialStore } from "./cloudEnrollmentCoordinator.ts";

const DAEMON_VERSION = "0.1.0";
const RETRY_AFTER_FAILURE_MS = 5_000;

type CloudEnrollmentAttemptCoordinatorOptions = {
  attempts: CloudEnrollmentAttemptRepository;
  enrollment: CloudEnrollmentCoordinator;
  secrets: CloudCredentialStore;
  httpClient: Pick<CloudConnectorHttpClient, "createEnrollmentAttempt" | "pollEnrollmentAttempt">;
  onConnected: (input: StartCloudEnrollmentAttemptInput & {
    machineId: string;
    machineCredential: string;
  }) => Promise<unknown>;
  retryAfterFailureMs?: number;
};

function addMilliseconds(timestamp: number, delayMs: number) {
  return new Date(timestamp + delayMs).toISOString();
}

function toAttemptErrorCode(error: unknown) {
  if (error instanceof Error && /^enrollment_(?:attempt|poll)_[a-z0-9_]+$/.test(error.message)) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "enrollment_poll_cancelled";
  return "enrollment_poll_transport_error";
}

/** Owns durable browser-confirmed Cloud enrollment attempts and restart-safe polling. */
export class CloudEnrollmentAttemptCoordinator {
  private closed = false;
  private controller = new AbortController();
  private operationEpoch = 0;
  private pollPromise: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: CloudEnrollmentAttemptCoordinatorOptions) {}

  start() {
    if (this.closed) return;
    this.resumeStoredAttempt();
  }

  async create(input: StartCloudEnrollmentAttemptInput): Promise<CloudEnrollmentAttemptResponse> {
    if (this.closed) throw new Error("enrollment_attempt_coordinator_closed");
    this.cancelPolling();
    this.removeStoredAttempt();
    const operationEpoch = this.operationEpoch;
    const lifecycleSignal = this.controller.signal;
    const identity = this.options.enrollment.getOrCreateIdentity();
    const attempt = await this.options.httpClient.createEnrollmentAttempt(
      input.cloudOrigin,
      {
        installationId: identity.installationId,
        displayName: input.displayName,
        localDaemonVersion: DAEMON_VERSION,
        capabilities: this.options.enrollment.getCapabilities(input)
      },
      lifecycleSignal
    );
    if (lifecycleSignal.aborted || operationEpoch !== this.operationEpoch) {
      throw new Error("enrollment_attempt_cancelled");
    }
    const secret = this.options.secrets.read(identity.credentialRef);
    this.options.secrets.write(identity.credentialRef, {
      ...secret,
      enrollmentAttempt: {
        attemptId: attempt.attemptId,
        attemptSecret: attempt.attemptSecret,
        verificationUrl: attempt.verificationUrl
      }
    });
    this.options.attempts.replace({
      attemptId: attempt.attemptId,
      cloudOrigin: input.cloudOrigin,
      displayName: input.displayName,
      credentialRef: identity.credentialRef,
      expiresAt: attempt.expiresAt,
      nextPollAt: addMilliseconds(Date.now(), attempt.pollIntervalMs),
      pollIntervalMs: attempt.pollIntervalMs,
      status: "pending",
      lastErrorCode: null,
      allowRemoteRead: input.allowRemoteRead,
      allowRemoteFiles: input.allowRemoteFiles,
      allowRemoteControl: input.allowRemoteControl,
      allowRemotePreview: input.allowRemotePreview
    });
    this.scheduleStoredAttempt();
    return this.read();
  }

  read(): CloudEnrollmentAttemptResponse {
    const record = this.options.attempts.read();
    if (!record) return { attempt: null };
    if (Date.parse(record.expiresAt) <= Date.now()) {
      this.removeStoredAttempt();
      return { attempt: null };
    }
    try {
      const enrollmentAttempt = this.options.secrets.read(record.credentialRef).enrollmentAttempt;
      if (!enrollmentAttempt || enrollmentAttempt.attemptId !== record.attemptId) {
        this.removeStoredAttempt();
        return { attempt: null };
      }
      return {
        attempt: {
          attemptId: record.attemptId,
          cloudOrigin: record.cloudOrigin,
          displayName: record.displayName,
          verificationUrl: enrollmentAttempt.verificationUrl,
          expiresAt: record.expiresAt,
          pollIntervalMs: record.pollIntervalMs,
          status: record.status,
          lastErrorCode: record.lastErrorCode
        }
      };
    } catch {
      this.options.attempts.remove();
      return { attempt: null };
    }
  }

  cancel(): CloudEnrollmentAttemptResponse {
    this.cancelPolling();
    this.removeStoredAttempt();
    return { attempt: null };
  }

  async close() {
    this.closed = true;
    this.cancelPolling();
    if (this.pollPromise) await Promise.allSettled([this.pollPromise]);
  }

  private resumeStoredAttempt() {
    const attempt = this.options.attempts.read();
    if (!attempt) return;
    if (Date.parse(attempt.expiresAt) <= Date.now()) {
      this.removeStoredAttempt();
      return;
    }
    this.scheduleStoredAttempt();
  }

  private scheduleStoredAttempt() {
    if (this.closed || this.timer || this.pollPromise) return;
    const attempt = this.options.attempts.read();
    if (!attempt || attempt.status !== "pending") return;
    const delayMs = Math.max(0, Date.parse(attempt.nextPollAt) - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pollPromise = this.poll(attempt).finally(() => {
        this.pollPromise = null;
        this.scheduleStoredAttempt();
      });
    }, delayMs);
    this.timer.unref?.();
  }

  private async poll(record: CloudEnrollmentAttemptRecord) {
    if (Date.parse(record.expiresAt) <= Date.now()) {
      this.removeStoredAttempt();
      return;
    }
    try {
      const operationEpoch = this.operationEpoch;
      const lifecycleSignal = this.controller.signal;
      const secret = this.options.secrets.read(record.credentialRef);
      const enrollmentAttempt = secret.enrollmentAttempt;
      if (!enrollmentAttempt || enrollmentAttempt.attemptId !== record.attemptId) {
        this.removeStoredAttempt();
        return;
      }
      const result = await this.options.httpClient.pollEnrollmentAttempt(
        record.cloudOrigin,
        record.attemptId,
        enrollmentAttempt.attemptSecret,
        lifecycleSignal
      );
      if (
        lifecycleSignal.aborted ||
        operationEpoch !== this.operationEpoch ||
        this.options.attempts.read()?.attemptId !== record.attemptId
      ) return;
      if (result.status === "connected") {
        await this.options.onConnected({
          cloudOrigin: record.cloudOrigin,
          displayName: record.displayName,
          allowRemoteRead: record.allowRemoteRead,
          allowRemoteFiles: record.allowRemoteFiles,
          allowRemoteControl: record.allowRemoteControl,
          allowRemotePreview: record.allowRemotePreview,
          machineId: result.machine.machineId,
          machineCredential: result.machineCredential
        });
        if (
          operationEpoch === this.operationEpoch &&
          this.options.attempts.read()?.attemptId === record.attemptId
        ) this.removeStoredAttempt();
        return;
      }
      const pollIntervalMs = result.pollIntervalMs ?? record.pollIntervalMs;
      this.options.attempts.scheduleNext(
        addMilliseconds(Date.now(), pollIntervalMs),
        pollIntervalMs
      );
    } catch (error) {
      if (
        this.closed ||
        this.options.attempts.read()?.attemptId !== record.attemptId
      ) return;
      if (toAttemptErrorCode(error) === "enrollment_poll_expired") {
        this.removeStoredAttempt();
        return;
      }
      this.options.attempts.scheduleNext(
        addMilliseconds(Date.now(), this.options.retryAfterFailureMs ?? RETRY_AFTER_FAILURE_MS),
        record.pollIntervalMs,
        toAttemptErrorCode(error)
      );
    }
  }

  private cancelPolling() {
    this.controller.abort();
    this.controller = new AbortController();
    this.operationEpoch += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private removeStoredAttempt() {
    const record = this.options.attempts.read();
    this.options.attempts.remove();
    if (!record) return;
    try {
      const secret = this.options.secrets.read(record.credentialRef);
      this.options.secrets.write(record.credentialRef, {
        privateKey: secret.privateKey,
        machineCredential: secret.machineCredential
      });
    } catch {
      this.options.secrets.remove(record.credentialRef);
    }
  }
}
