import { CLOUD_RELAY_STREAM } from "@deskcue/protocol/cloud";
import type { CloudRelayCapability } from "@deskcue/protocol/cloud";

import { readBoundedCloudResponse } from "../cloudBoundedResponse.ts";

export const CLOUD_CONNECTOR_HTTP_TIMEOUT_MS = 10_000;
const CLOUD_CONNECTOR_HTTP_RESPONSE_MAX_BYTES = 65_536;
const CLOUD_MACHINE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CLOUD_OPAQUE_CREDENTIAL_PATTERN = /^[\x21-\x7e]{8,8192}$/;
const CLOUD_ATTEMPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CLOUD_ENROLLMENT_POLL_MIN_MS = 1_000;
const CLOUD_ENROLLMENT_POLL_MAX_MS = 30_000;

export type CloudEnrollmentRequest = {
  enrollmentTicket: string;
  installationId: string;
  displayName: string;
  localDaemonVersion: string;
  capabilities: CloudRelayCapability[];
};

export type CloudEnrollment = {
  machine: { machineId: string };
  machineCredential: string;
};

export type CloudConnectionToken = {
  connectionToken: string;
  relayUrl: string;
  expiresAt: string;
  cursors: Record<string, number>;
};

export type CloudEnrollmentAttemptRequest = Omit<CloudEnrollmentRequest, "enrollmentTicket">;

export type CloudEnrollmentAttempt = {
  attemptId: string;
  attemptSecret: string;
  verificationUrl: string;
  expiresAt: string;
  pollIntervalMs: number;
};

export type CloudEnrollmentAttemptPoll =
  | { status: "pending"; expiresAt: string; pollIntervalMs?: number }
  | {
      status: "connected";
      machine: { machineId: string };
      machineCredential: string;
      expiresAt: string;
    };

function parseFutureTimestamp(value: unknown, errorCode: string) {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new Error(errorCode);
  return value as string;
}

function parseVerificationUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("enrollment_attempt_invalid_response");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("enrollment_attempt_invalid_verification_url");
  }
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
    url.username ||
    url.password
  ) {
    throw new Error("enrollment_attempt_invalid_verification_url");
  }
  return url.toString();
}

function parseEnrollmentAttemptResponse(value: unknown): CloudEnrollmentAttempt {
  if (!value || typeof value !== "object") throw new Error("enrollment_attempt_invalid_response");
  const response = value as Partial<CloudEnrollmentAttempt>;
  if (
    typeof response.attemptId !== "string" ||
    !CLOUD_ATTEMPT_ID_PATTERN.test(response.attemptId) ||
    typeof response.attemptSecret !== "string" ||
    !CLOUD_OPAQUE_CREDENTIAL_PATTERN.test(response.attemptSecret) ||
    !Number.isSafeInteger(response.pollIntervalMs) ||
    (response.pollIntervalMs as number) < CLOUD_ENROLLMENT_POLL_MIN_MS ||
    (response.pollIntervalMs as number) > CLOUD_ENROLLMENT_POLL_MAX_MS
  ) {
    throw new Error("enrollment_attempt_invalid_response");
  }
  return {
    attemptId: response.attemptId,
    attemptSecret: response.attemptSecret,
    verificationUrl: parseVerificationUrl(response.verificationUrl),
    expiresAt: parseFutureTimestamp(response.expiresAt, "enrollment_attempt_invalid_response"),
    pollIntervalMs: response.pollIntervalMs as number
  };
}

function parseEnrollmentAttemptPollResponse(value: unknown): CloudEnrollmentAttemptPoll {
  if (!value || typeof value !== "object") throw new Error("enrollment_poll_invalid_response");
  const response = value as Partial<CloudEnrollmentAttemptPoll>;
  const expiresAt = parseFutureTimestamp(response.expiresAt, "enrollment_poll_expired");
  if (response.status === "connected") {
    if (
      !response.machine ||
      typeof response.machine.machineId !== "string" ||
      !CLOUD_MACHINE_ID_PATTERN.test(response.machine.machineId) ||
      typeof response.machineCredential !== "string" ||
      !CLOUD_OPAQUE_CREDENTIAL_PATTERN.test(response.machineCredential)
    ) throw new Error("enrollment_poll_invalid_response");
    return {
      status: "connected",
      machine: { machineId: response.machine.machineId },
      machineCredential: response.machineCredential,
      expiresAt
    };
  }
  if (response.status !== "pending") throw new Error("enrollment_poll_invalid_response");
  if (
    response.pollIntervalMs !== undefined &&
    (!Number.isSafeInteger(response.pollIntervalMs) ||
      response.pollIntervalMs < CLOUD_ENROLLMENT_POLL_MIN_MS ||
      response.pollIntervalMs > CLOUD_ENROLLMENT_POLL_MAX_MS)
  ) throw new Error("enrollment_poll_invalid_response");
  return { status: "pending", expiresAt, pollIntervalMs: response.pollIntervalMs };
}

function parseEnrollmentResponse(value: unknown): CloudEnrollment {
  if (!value || typeof value !== "object") throw new Error("enrollment_invalid_response");
  const response = value as Partial<CloudEnrollment>;
  if (
    !response.machine ||
    typeof response.machine.machineId !== "string" ||
    !CLOUD_MACHINE_ID_PATTERN.test(response.machine.machineId) ||
    typeof response.machineCredential !== "string" ||
    !CLOUD_OPAQUE_CREDENTIAL_PATTERN.test(response.machineCredential)
  ) {
    throw new Error("enrollment_invalid_response");
  }
  return response as CloudEnrollment;
}

export function parseCloudConnectionTokenResponse(
  value: unknown,
  cloudOrigin: string,
  machineId: string
): CloudConnectionToken {
  if (!value || typeof value !== "object") throw new Error("connection_invalid_response");
  const response = value as Partial<CloudConnectionToken>;
  const cursor = response.cursors?.[CLOUD_RELAY_STREAM];
  const expiresAt = typeof response.expiresAt === "string"
    ? Date.parse(response.expiresAt)
    : Number.NaN;
  if (
    typeof response.connectionToken !== "string" ||
    !CLOUD_OPAQUE_CREDENTIAL_PATTERN.test(response.connectionToken) ||
    typeof response.relayUrl !== "string" ||
    !CLOUD_MACHINE_ID_PATTERN.test(machineId) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    !Number.isSafeInteger(cursor) ||
    (cursor as number) < 0
  ) {
    throw new Error("connection_invalid_response");
  }
  const relayUrl = new URL(response.relayUrl);
  const cloudUrl = new URL(cloudOrigin);
  const expectedProtocol = cloudUrl.protocol === "https:" ? "wss:" : "ws:";
  if (
    relayUrl.protocol !== expectedProtocol ||
    relayUrl.host !== cloudUrl.host ||
    relayUrl.username ||
    relayUrl.password ||
    relayUrl.search ||
    relayUrl.hash ||
    relayUrl.pathname !== `/relay/machines/${encodeURIComponent(machineId)}`
  ) {
    throw new Error("connection_invalid_relay_url");
  }
  return response as CloudConnectionToken;
}

/** Owns the bounded HTTP wire contract used before the relay socket is opened. */
export class CloudConnectorHttpClient {
  constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  async enroll(
    cloudOrigin: string,
    request: CloudEnrollmentRequest,
    lifecycleSignal?: AbortSignal
  ): Promise<CloudEnrollment> {
    return parseEnrollmentResponse(await this.postJson(
      `${cloudOrigin}/machines/enroll`,
      request,
      "enrollment",
      undefined,
      lifecycleSignal
    ));
  }

  async createEnrollmentAttempt(
    cloudOrigin: string,
    request: CloudEnrollmentAttemptRequest,
    lifecycleSignal?: AbortSignal
  ): Promise<CloudEnrollmentAttempt> {
    return parseEnrollmentAttemptResponse(await this.postJson(
      `${cloudOrigin}/machines/enrollment-attempts`,
      request,
      "enrollment_attempt",
      undefined,
      lifecycleSignal
    ));
  }

  async pollEnrollmentAttempt(
    cloudOrigin: string,
    attemptId: string,
    attemptSecret: string,
    lifecycleSignal?: AbortSignal
  ): Promise<CloudEnrollmentAttemptPoll> {
    return parseEnrollmentAttemptPollResponse(await this.postJson(
      `${cloudOrigin}/machines/enrollment-attempts/${encodeURIComponent(attemptId)}/poll`,
      { attemptSecret },
      "enrollment_poll",
      undefined,
      lifecycleSignal
    ));
  }

  async createConnectionToken(
    cloudOrigin: string,
    machineId: string,
    machineCredential: string,
    lifecycleSignal?: AbortSignal
  ): Promise<CloudConnectionToken> {
    const response = await this.postJson(
      `${cloudOrigin}/machines/${encodeURIComponent(machineId)}/connections`,
      {},
      "connection",
      machineCredential,
      lifecycleSignal
    );
    return parseCloudConnectionTokenResponse(response, cloudOrigin, machineId);
  }

  async replaceCapabilities(
    cloudOrigin: string,
    machineId: string,
    machineCredential: string,
    capabilities: CloudRelayCapability[],
    lifecycleSignal?: AbortSignal
  ): Promise<void> {
    const { response, bytes } = await this.sendJson(
      `${cloudOrigin}/machines/${encodeURIComponent(machineId)}/capabilities`,
      { capabilities },
      "capabilities",
      "PUT",
      machineCredential,
      lifecycleSignal
    );
    if (response.status !== 204 || bytes.byteLength !== 0) {
      throw new Error("capabilities_invalid_response");
    }
  }

  private async postJson(
    url: string,
    body: unknown,
    endpoint: "enrollment" | "enrollment_attempt" | "enrollment_poll" | "connection",
    bearerToken?: string,
    lifecycleSignal?: AbortSignal
  ): Promise<unknown> {
    const { bytes } = await this.sendJson(
      url,
      body,
      endpoint,
      "POST",
      bearerToken,
      lifecycleSignal
    );
    if (bytes.byteLength === 0) throw new Error(`${endpoint}_invalid_response`);
    return JSON.parse(bytes.toString("utf8")) as unknown;
  }

  private async sendJson(
    url: string,
    body: unknown,
    endpoint: "enrollment" | "enrollment_attempt" | "enrollment_poll" | "connection" | "capabilities",
    method: "POST" | "PUT",
    bearerToken?: string,
    lifecycleSignal?: AbortSignal
  ): Promise<{ response: Response; bytes: Buffer }> {
    lifecycleSignal?.throwIfAborted();
    const controller = new AbortController();
    const signal = lifecycleSignal
      ? AbortSignal.any([controller.signal, lifecycleSignal])
      : controller.signal;
    const timeout = setTimeout(() => controller.abort(), CLOUD_CONNECTOR_HTTP_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const response = await this.fetchImplementation(url, {
        method,
        headers: {
          "content-type": "application/json",
          ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {})
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal
      });
      lifecycleSignal?.throwIfAborted();
      if (!response.ok) throw new Error(`${endpoint}_http_${response.status}`);
      const bytes = await readBoundedCloudResponse(
        response,
        CLOUD_CONNECTOR_HTTP_RESPONSE_MAX_BYTES
      );
      lifecycleSignal?.throwIfAborted();
      if (!bytes) throw new Error("cloud_http_response_too_large");
      return { response, bytes };
    } finally {
      clearTimeout(timeout);
    }
  }
}
