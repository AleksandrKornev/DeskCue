export interface AccessLinkResponse {
  daemonUrl: string;
  hostSource?: "public_host" | "lan_address" | "request_host";
  lanReady?: boolean;
  pairCode: string;
  warnings?: string[];
  webUrl: string;
}

export interface AccessLinkStatusResponse {
  status: "active" | "used" | "expired_or_invalid";
}

export interface PairAccessInput {
  code: string;
}

export interface PairAccessResponse {
  accessToken: string;
  daemonUrl: string;
  deviceId: string;
}

export interface CreateAccessRecoveryCodeResponse {
  code: string;
  expiresAt: string;
}

export interface RedeemAccessRecoveryCodeInput {
  code: string;
}

export interface AccessDeviceSummary {
  id: string;
  label: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  lastIp: string | null;
  revokedAt: string | null;
  current: boolean;
}

export interface CurrentAccessState {
  authRequired: boolean;
  credentialPresented: boolean;
  deviceId: string | null;
  trustedHost: boolean;
}

export interface AccessDevicesResponse {
  currentAccess: CurrentAccessState;
  devices: AccessDeviceSummary[];
}

export interface UpdateAccessDeviceInput {
  label: string;
}

export interface UpdateAccessDeviceResponse {
  device: AccessDeviceSummary;
}

export const MAX_ASSET_TICKET_BYTES = 100 * 1024 * 1024;

export interface CreateAssetTicketInput {
  agentSessionId?: string;
  download?: boolean;
  kind: "file" | "local_image";
  managedSessionId?: string;
  maxBytes?: number;
  path: string;
  workspaceId?: string;
}

export interface CreateAssetTicketResponse {
  expiresAt: string;
  url: string;
}

export interface RevokeAccessDevicesResponse {
  revokedCount: number;
}

export type SecurityExposureLevel = "local_only" | "lan_exposed" | "public_exposed";

export type SecurityRiskLevel = "low" | "medium" | "high";

export interface SecurityStatusResponse {
  authRequired: boolean;
  bindHost: string;
  publicHost: string | null;
  allowedOrigins: string[];
  accessTokenSource: "devices";
  exposureLevel: SecurityExposureLevel;
  protocolCapabilities: string[];
  protocolVersion: number;
  riskLevel: SecurityRiskLevel;
  summary: string;
  warnings: string[];
}

export function parsePairAccessInput(value: unknown): PairAccessInput {
  const body = readProtocolObject(value);

  return { code: readRequiredProtocolString(body, "code") };
}

export function parseRedeemAccessRecoveryCodeInput(
  value: unknown
): RedeemAccessRecoveryCodeInput {
  const body = readProtocolObject(value);

  return { code: readRequiredProtocolString(body, "code") };
}

export function parseUpdateAccessDeviceInput(value: unknown): UpdateAccessDeviceInput {
  const body = readProtocolObject(value);
  const label = readRequiredProtocolString(body, "label").trim();

  if (label.length > 80) throw new ProtocolSchemaError("Field label must be 80 characters or fewer.");

  return { label };
}

export function parseCreateAssetTicketInput(value: unknown): CreateAssetTicketInput {
  const body = readProtocolObject(value);
  const kind = body.kind ?? "file";

  if (kind !== "file" && kind !== "local_image") {
    throw new ProtocolSchemaError("Field kind must be file or local_image.");
  }

  if (body.download !== undefined && typeof body.download !== "boolean") {
    throw new ProtocolSchemaError("Field download must be a boolean when provided.");
  }

  if (
    body.maxBytes !== undefined &&
    (typeof body.maxBytes !== "number" ||
      !Number.isSafeInteger(body.maxBytes) ||
      body.maxBytes < 1 ||
      body.maxBytes > MAX_ASSET_TICKET_BYTES)
  ) {
    throw new ProtocolSchemaError(
      `Field maxBytes must be a positive safe integer no greater than ${MAX_ASSET_TICKET_BYTES}.`
    );
  }

  return {
    agentSessionId: readOptionalProtocolString(body, "agentSessionId"),
    download: body.download === true,
    kind,
    managedSessionId: readOptionalProtocolString(body, "managedSessionId"),
    maxBytes: body.maxBytes as number | undefined,
    path: readRequiredProtocolString(body, "path"),
    workspaceId: readOptionalProtocolString(body, "workspaceId")
  };
}

import {
  ProtocolSchemaError,
  readOptionalProtocolString,
  readProtocolObject,
  readRequiredProtocolString
} from "./schema.ts";
