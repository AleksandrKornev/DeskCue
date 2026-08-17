import type { RuntimeKind } from "./sessions.ts";
import {
  ProtocolSchemaError,
  readProtocolObject,
  readRequiredProtocolString
} from "./schema.ts";

export interface RuntimeSummary {
  id: RuntimeKind;
  label: string;
  installed: boolean;
  running: boolean;
  endpoint: string | null;
  modelCount: number;
  loadedModelCount: number;
  lastActiveModel: string | null;
  statusText: string;
  /** Local model storage used for diagnostics only; no model data is exposed. */
  modelStoragePath?: string | null;
  modelStorageSource?: "default" | "environment" | "runtime";
  /** Whether DeskCue can create its own writable chat for this runtime. */
  chatCapability?: "unavailable" | "history_replay" | "native_session";
}

export interface LmStudioInstalledModel {
  displayName: string;
  modelKey: string;
  path: string;
}

export interface OllamaInstalledModel {
  displayName: string;
  modelKey: string;
}

export interface OllamaModelsResponse {
  models: OllamaInstalledModel[];
}

export interface OllamaServerStartResponse {
  alreadyRunning: boolean;
  runtime: RuntimeSummary;
  startRequested: boolean;
}

export interface LmStudioModelsResponse {
  models: LmStudioInstalledModel[];
}

export interface LmStudioServerStartResponse {
  alreadyRunning: boolean;
  runtime: RuntimeSummary;
  startRequested: boolean;
}

export interface LmStudioPrepareResponse extends LmStudioServerStartResponse {
  model: LmStudioInstalledModel;
  modelLoadRequested: boolean;
}

export interface PrepareLmStudioModelInput {
  model: string;
}

const LM_STUDIO_MODEL_KEY_MAX_LENGTH = 2_048;
const OLLAMA_MODEL_CATALOG_LIMIT = 256;
const OLLAMA_MODEL_FIELD_MAX_LENGTH = 512;

export function parseOllamaModelsResponse(value: unknown): OllamaModelsResponse {
  const body = readProtocolObject(value);
  if (!Array.isArray(body.models)) {
    throw new ProtocolSchemaError("Field models must be an array.");
  }
  if (body.models.length > OLLAMA_MODEL_CATALOG_LIMIT) {
    throw new ProtocolSchemaError(`Field models exceeds the ${OLLAMA_MODEL_CATALOG_LIMIT}-item limit.`);
  }

  return {
    models: body.models.map((value, index) => {
      const model = readProtocolObject(value);
      const displayName = readRequiredProtocolString(model, "displayName").trim();
      const modelKey = readRequiredProtocolString(model, "modelKey").trim();
      if (displayName.length > OLLAMA_MODEL_FIELD_MAX_LENGTH || modelKey.length > OLLAMA_MODEL_FIELD_MAX_LENGTH) {
        throw new ProtocolSchemaError(
          `Field models[${index}] exceeds the ${OLLAMA_MODEL_FIELD_MAX_LENGTH}-character field limit.`
        );
      }
      return { displayName, modelKey };
    })
  };
}

export function parsePrepareLmStudioModelInput(value: unknown): PrepareLmStudioModelInput {
  const model = readRequiredProtocolString(readProtocolObject(value), "model").trim();
  if (model.length > LM_STUDIO_MODEL_KEY_MAX_LENGTH) {
    throw new ProtocolSchemaError(
      `Field model exceeds the ${LM_STUDIO_MODEL_KEY_MAX_LENGTH.toLocaleString("en-US")}-character limit.`
    );
  }
  return { model };
}
