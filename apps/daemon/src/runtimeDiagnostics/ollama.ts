import os from "node:os";
import path from "node:path";

import type { OllamaInstalledModel, RuntimeSummary } from "@deskcue/protocol";
import { AppError } from "#application/errors";
import { daemonConfig } from "#config/daemonConfig";

import { commandExists, exists } from "./shared.ts";
type OllamaRuntimeProbes = {
  commandExists?: typeof commandExists;
  exists: typeof exists;
  fetchJson: <T>(url: string) => Promise<T | null>;
};

interface OllamaModel {
  model?: unknown;
  name?: unknown;
}

const OLLAMA_HOME = path.join(os.homedir(), ".ollama");
const OLLAMA_BIN = process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Ollama", "ollama.exe")
  : "/usr/local/bin/ollama";

const OLLAMA_MODEL_CATALOG_LIMIT = 256;
const OLLAMA_MODEL_KEY_MAX_LENGTH = 512;
const OLLAMA_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

function readOllamaModelKey(entry: OllamaModel) {
  const rawModelKey = typeof entry.name === "string"
    ? entry.name
    : typeof entry.model === "string"
      ? entry.model
      : "";
  const modelKey = rawModelKey.trim();
  return modelKey && modelKey.length <= OLLAMA_MODEL_KEY_MAX_LENGTH ? modelKey : null;
}

async function fetchBoundedOllamaJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(daemonConfig.runtimeHttpTimeoutMs)
    });
    if (!response.ok || !response.body) return null;
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > OLLAMA_RESPONSE_MAX_BYTES) {
      await response.body.cancel();
      return null;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > OLLAMA_RESPONSE_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const payload = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

const defaultProbes: OllamaRuntimeProbes = {
  commandExists,
  exists,
  fetchJson: fetchBoundedOllamaJson
};

export async function listOllamaModels(
  probes: Pick<OllamaRuntimeProbes, "fetchJson"> = defaultProbes
): Promise<OllamaInstalledModel[]> {
  const endpoint = daemonConfig.runtimeEndpoints.ollamaEndpoint;
  const response = await probes.fetchJson<{ models?: unknown }>(`${endpoint}/api/tags`);
  if (!response) {
    throw new AppError("runtime_unavailable", "DeskCue could not read the locally installed Ollama models.");
  }

  const candidates = Array.isArray(response.models)
    ? response.models.slice(0, OLLAMA_MODEL_CATALOG_LIMIT)
    : [];
  const seen = new Set<string>();
  const models: OllamaInstalledModel[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const modelKey = readOllamaModelKey(candidate as OllamaModel);
    if (!modelKey || seen.has(modelKey)) continue;
    seen.add(modelKey);
    models.push({ displayName: modelKey, modelKey });
  }
  return models;
}

export async function inspectOllamaRuntime(
  probes: OllamaRuntimeProbes = defaultProbes
): Promise<RuntimeSummary> {
  const configuredModelStoragePath = process.env.OLLAMA_MODELS?.trim() || null;
  const modelStoragePath = configuredModelStoragePath || path.join(OLLAMA_HOME, "models");
  const installed =
    await probes.exists(OLLAMA_HOME) ||
    await probes.exists(OLLAMA_BIN) ||
    await probes.commandExists?.("ollama") === true;
  const endpoint = daemonConfig.runtimeEndpoints.ollamaEndpoint;
  const [tagsResponse, psResponse] = await Promise.all([
    probes.fetchJson<{ models?: OllamaModel[] }>(`${endpoint}/api/tags`),
    probes.fetchJson<{ models?: OllamaModel[] }>(`${endpoint}/api/ps`)
  ]);
  const models = Array.isArray(tagsResponse?.models) ? tagsResponse.models : [];
  const loadedModels = Array.isArray(psResponse?.models) ? psResponse.models : [];

  return {
    id: "ollama",
    label: "Ollama",
    installed,
    running: Boolean(tagsResponse),
    endpoint,
    modelCount: models.length,
    loadedModelCount: loadedModels.length,
    lastActiveModel: loadedModels.length > 0 ? readOllamaModelKey(loadedModels[0]) : null,
    modelStoragePath,
    modelStorageSource: configuredModelStoragePath ? "environment" : "default",
    chatCapability: tagsResponse && models.length > 0 ? "history_replay" : "unavailable",
    statusText: !installed
      ? "not installed"
      : tagsResponse
        ? models.length > 0
          ? `${models.length} local models available`
          : "API reachable, no models at this endpoint"
        : "installed, API not responding"
  };
}
