export type DaemonSettingField =
  | "authRequired"
  | "publicHost"
  | "allowedOrigins"
  | "pairingHosts"
  | "storageMaxMb"
  | "agentDataRoots"
  | "runtimeEndpoints";

export type DaemonSettingSource = "web" | "env" | "default";

export interface DaemonSettingSourceDetail<TValue> {
  source: DaemonSettingSource;
  value: TValue;
  webValue: TValue | null;
  envValue: TValue | null;
  defaultValue: TValue;
}

export interface AgentDataRoots {
  codexHome: string;
  claudeHome: string;
  lmStudioHome: string;
}

export type UpdateAgentDataRootsInput = Partial<
  Record<keyof AgentDataRoots, string | null>
>;

export interface RuntimeEndpoints {
  ollamaEndpoint: string;
  lmStudioEndpoint: string;
}

export type UpdateRuntimeEndpointsInput = Partial<
  Record<keyof RuntimeEndpoints, string | null>
>;

export interface DaemonSettingsResponse {
  authRequired: boolean;
  bindHost: string;
  publicHost: string | null;
  allowedOrigins: string[];
  pairingHosts: string[];
  storageMaxMb: number;
  agentDataRoots: AgentDataRoots;
  runtimeEndpoints: RuntimeEndpoints;
  lockedFields: DaemonSettingField[];
  settingsFilePath: string;
  sources: {
    authRequired: DaemonSettingSourceDetail<boolean>;
    publicHost: DaemonSettingSourceDetail<string | null>;
    allowedOrigins: DaemonSettingSourceDetail<string[]>;
    pairingHosts: DaemonSettingSourceDetail<string[]>;
    storageMaxMb: DaemonSettingSourceDetail<number>;
    agentDataRoots: DaemonSettingSourceDetail<AgentDataRoots>;
    runtimeEndpoints: DaemonSettingSourceDetail<RuntimeEndpoints>;
  };
  accessToken?: string;
  daemonUrl?: string;
  deviceId?: string;
}

export interface UpdateDaemonSettingsInput {
  authRequired?: boolean;
  publicHost?: string | null;
  allowedOrigins?: string[];
  pairingHosts?: string[];
  storageMaxMb?: number;
  agentDataRoots?: UpdateAgentDataRootsInput;
  runtimeEndpoints?: UpdateRuntimeEndpointsInput;
}

export function parseUpdateDaemonSettingsInput(value: unknown): UpdateDaemonSettingsInput {
  const body = readProtocolObject(value);
  const input: UpdateDaemonSettingsInput = {};

  if ("authRequired" in body) {
    if (typeof body.authRequired !== "boolean") {
      throw new ProtocolSchemaError("Field authRequired must be a boolean.");
    }
    input.authRequired = body.authRequired;
  }

  if ("publicHost" in body) {
    if (body.publicHost === null || body.publicHost === "") {
      input.publicHost = null;
    } else if (typeof body.publicHost === "string") {
      input.publicHost = body.publicHost.trim() || null;
    } else {
      throw new ProtocolSchemaError("Field publicHost must be a string or null.");
    }
  }

  for (const fieldName of ["allowedOrigins", "pairingHosts"] as const) {
    if (!(fieldName in body)) {
      continue;
    }
    const values = body[fieldName];
    if (!Array.isArray(values)) {
      throw new ProtocolSchemaError(`Field ${fieldName} must be an array.`);
    }
    input[fieldName] = values.map((value) => {
      if (typeof value !== "string" || value.trim() === "") {
        throw new ProtocolSchemaError(
          fieldName === "allowedOrigins"
            ? "Allowed origins must be non-empty strings."
            : "Pairing hosts must be non-empty strings."
        );
      }
      return value.trim();
    });
  }

  if ("storageMaxMb" in body) {
    if (
      typeof body.storageMaxMb !== "number" ||
      !Number.isInteger(body.storageMaxMb) ||
      body.storageMaxMb < 20 ||
      body.storageMaxMb > 500
    ) {
      throw new ProtocolSchemaError(
        "Field storageMaxMb must be an integer between 20 and 500."
      );
    }
    input.storageMaxMb = body.storageMaxMb;
  }

  if ("agentDataRoots" in body) {
    if (!body.agentDataRoots || typeof body.agentDataRoots !== "object" || Array.isArray(body.agentDataRoots)) {
      throw new ProtocolSchemaError("Field agentDataRoots must be an object.");
    }
    const values = body.agentDataRoots as Record<string, unknown>;
    input.agentDataRoots = {};
    for (const fieldName of ["codexHome", "claudeHome", "lmStudioHome"] as const) {
      if (!(fieldName in values)) continue;
      const fieldValue = values[fieldName];
      if (fieldValue === null || fieldValue === "") {
        input.agentDataRoots[fieldName] = null;
      } else if (typeof fieldValue === "string") {
        input.agentDataRoots[fieldName] = fieldValue.trim() || null;
      } else {
        throw new ProtocolSchemaError(
          `Field agentDataRoots.${fieldName} must be a string or null.`
        );
      }
    }
  }

  if ("runtimeEndpoints" in body) {
    if (!body.runtimeEndpoints || typeof body.runtimeEndpoints !== "object" || Array.isArray(body.runtimeEndpoints)) {
      throw new ProtocolSchemaError("Field runtimeEndpoints must be an object.");
    }
    const values = body.runtimeEndpoints as Record<string, unknown>;
    input.runtimeEndpoints = {};
    for (const fieldName of ["ollamaEndpoint", "lmStudioEndpoint"] as const) {
      if (!(fieldName in values)) continue;
      const fieldValue = values[fieldName];
      if (fieldValue === null || fieldValue === "") {
        input.runtimeEndpoints[fieldName] = null;
      } else if (typeof fieldValue === "string") {
        input.runtimeEndpoints[fieldName] = fieldValue.trim() || null;
      } else {
        throw new ProtocolSchemaError(
          `Field runtimeEndpoints.${fieldName} must be a string or null.`
        );
      }
    }
  }

  return input;
}
import { ProtocolSchemaError, readProtocolObject } from "./schema.ts";
