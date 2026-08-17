import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type {
  LmStudioInstalledModel,
  LmStudioPrepareResponse,
  LmStudioServerStartResponse,
  RuntimeSummary
} from "@deskcue/protocol";
import { AppError } from "#application/errors";
import { daemonConfig } from "#config/daemonConfig";

import { inspectLmStudioRuntime } from "./lmStudio.ts";
import { exists } from "./shared.ts";

type StartLmStudioServerOptions = {
  exists?: typeof exists;
  inspectRuntime?: typeof inspectLmStudioRuntime;
  runCommand?: (command: string, args: string[], signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

type ListLmStudioModelsOptions = Pick<StartLmStudioServerOptions, "exists"> & {
  inspectRuntime?: typeof inspectLmStudioRuntime;
  runLoadedModelsOutput?: (command: string, args: string[], signal?: AbortSignal) => Promise<string>;
  runCommandOutput?: (command: string, args: string[], signal?: AbortSignal) => Promise<string>;
  signal?: AbortSignal;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

type PrepareLmStudioModelOptions = StartLmStudioServerOptions & Pick<
  ListLmStudioModelsOptions,
  "runCommandOutput" | "runLoadedModelsOutput"
> & {
  startServer?: () => Promise<LmStudioServerStartResponse>;
};

type LmStudioModelCatalogEntry = LmStudioInstalledModel & {
  aliases: readonly string[];
};

export type LmStudioModelReadiness = "ready" | "server_off" | "model_unloaded";

const execFileAsync = promisify(execFile);

const LM_STUDIO_STARTUP_TIMEOUT_MS = 15_000;
const LM_STUDIO_STARTUP_POLL_INTERVAL_MS = 500;
const LM_STUDIO_MODEL_LOAD_TIMEOUT_MS = 120_000;
// The `lms` catalog can briefly be empty while its background service finishes
// waking. Keep the recovery bounded, but do not turn that transient state into
// a needless "choose a model" detour for a chat that already has one.
const LM_STUDIO_MODEL_CATALOG_TIMEOUT_MS = 5_000;
const LM_STUDIO_CLI_AVAILABILITY_ATTEMPTS =
  Math.ceil(LM_STUDIO_MODEL_CATALOG_TIMEOUT_MS / LM_STUDIO_STARTUP_POLL_INTERVAL_MS) + 1;

function normalizeLmStudioModelReference(value: string) {
  return value.trim().replaceAll("\\", "/").toLocaleLowerCase("en-US");
}

function resolveLmStudioInstalledModel(model: string, models: readonly LmStudioModelCatalogEntry[]) {
  const normalizedModel = normalizeLmStudioModelReference(model);
  const resolved = models.find((candidate) => candidate.aliases.includes(normalizedModel));
  if (!resolved) {
    throw new AppError(
      "invalid_input",
      "This LM Studio chat is not linked to an exact locally installed model. Choose a local model before sending."
    );
  }
  return {
    displayName: resolved.displayName,
    modelKey: resolved.modelKey,
    path: resolved.path
  };
}

function resolveLmStudioInstalledModelOrNull(model: string, models: readonly LmStudioModelCatalogEntry[]) {
  const normalizedModel = normalizeLmStudioModelReference(model);
  const resolved = models.find((candidate) => candidate.aliases.includes(normalizedModel));
  return resolved
    ? { displayName: resolved.displayName, modelKey: resolved.modelKey, path: resolved.path }
    : null;
}

function stripLmStudioVariant(value: string) {
  return value.replace(/@[^/]+$/u, "").trim();
}

function parseLmStudioModelCatalog(value: string): LmStudioModelCatalogEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppError("runtime_unavailable", "DeskCue could not read the locally installed LM Studio models.");
  }
  if (!Array.isArray(parsed)) {
    throw new AppError("runtime_unavailable", "LM Studio returned an invalid local model catalog.");
  }
  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as {
      displayName?: unknown;
      modelKey?: unknown;
      path?: unknown;
      selectedVariant?: unknown;
      type?: unknown;
      variants?: unknown;
    };
    if ((candidate.type !== "llm" && candidate.type !== "vlm") ||
      typeof candidate.displayName !== "string" ||
      typeof candidate.modelKey !== "string" ||
      typeof candidate.path !== "string" ||
      !candidate.displayName.trim() || !candidate.modelKey.trim() || !candidate.path.trim()) {
      return [];
    }
    const displayName = candidate.displayName.trim();
    const modelKey = candidate.modelKey.trim();
    const modelPath = candidate.path.trim();
    const variants = Array.isArray(candidate.variants)
      ? candidate.variants.filter((variant): variant is string => typeof variant === "string" && Boolean(variant.trim()))
      : [];
    const selectedVariant = typeof candidate.selectedVariant === "string" && candidate.selectedVariant.trim()
      ? candidate.selectedVariant.trim()
      : null;
    return [{
      aliases: [...new Set([
        modelKey,
        modelPath,
        displayName,
        selectedVariant,
        ...variants,
        stripLmStudioVariant(modelKey),
        stripLmStudioVariant(modelPath)
      ].filter((reference): reference is string => Boolean(reference)).map(normalizeLmStudioModelReference))],
      displayName,
      modelKey,
      path: modelPath
    }];
  });
}

function parseLmStudioInstalledModels(value: string): LmStudioInstalledModel[] {
  return parseLmStudioModelCatalog(value).map(({ aliases: _aliases, ...model }) => model);
}

async function waitForLmStudioRuntime(
  inspectRuntime: typeof inspectLmStudioRuntime,
  wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  timeoutMs: number,
  signal?: AbortSignal
) {
  const deadline = Date.now() + timeoutMs;
  let runtime: RuntimeSummary | null = null;

  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      runtime = await inspectRuntime();
      if (runtime.running) {
        return runtime;
      }
    } catch {
      // `lms ls --json` can briefly fail while LM Studio is waking its
      // service. Startup availability is authoritative, so keep polling.
    }
    await wait(Math.min(LM_STUDIO_STARTUP_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())), signal);
  }

  return runtime;
}

async function waitForLmStudioModel(
  inspectRuntime: typeof inspectLmStudioRuntime,
  wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  timeoutMs: number,
  signal?: AbortSignal
) {
  const deadline = Date.now() + timeoutMs;
  let runtime = await inspectRuntime();

  while (runtime.loadedModelCount < 1 && Date.now() < deadline) {
    signal?.throwIfAborted();
    await wait(Math.min(LM_STUDIO_STARTUP_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())), signal);
    runtime = await inspectRuntime();
  }

  return runtime;
}

function getLmStudioCommandPath() {
  return path.join(
    daemonConfig.agentDataRoots.lmStudioHome,
    "bin",
    process.platform === "win32" ? "lms.exe" : "lms"
  );
}

async function requireLmStudioCommand(
  pathExists: typeof exists,
  inspectRuntime: typeof inspectLmStudioRuntime,
  wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
  knownRuntime?: RuntimeSummary
) {
  const command = getLmStudioCommandPath();
  for (let attempt = 0; attempt < LM_STUDIO_CLI_AVAILABILITY_ATTEMPTS; attempt += 1) {
    signal?.throwIfAborted();
    if (await pathExists(command)) return command;
    if (attempt < LM_STUDIO_CLI_AVAILABILITY_ATTEMPTS - 1) {
      await wait(LM_STUDIO_STARTUP_POLL_INTERVAL_MS, signal);
    }
  }

  let runtime = knownRuntime ?? null;
  if (!runtime) {
    try {
      runtime = await inspectRuntime();
    } catch {
      // A failed runtime probe cannot prove that LM Studio is not installed.
    }
  }
  if (runtime?.installed || runtime?.running) {
    throw new AppError(
      "runtime_unavailable",
      "LM Studio is still starting. DeskCue could not access its CLI before the startup timeout."
    );
  }
  if (!runtime) {
    throw new AppError(
      "runtime_unavailable",
      "DeskCue could not verify that the LM Studio CLI is available. Try again after LM Studio finishes starting."
    );
  }
  throw new AppError("runtime_unavailable", "LM Studio CLI is not installed on this machine.");
}

async function waitForLmStudioInstalledModel(
  model: string,
  runCommandOutput: (command: string, args: string[], signal?: AbortSignal) => Promise<string>,
  wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal
) {
  const command = getLmStudioCommandPath();
  const deadline = Date.now() + LM_STUDIO_MODEL_CATALOG_TIMEOUT_MS;
  let latestCatalog: LmStudioModelCatalogEntry[] = [];

  do {
    signal?.throwIfAborted();
    try {
      latestCatalog = parseLmStudioModelCatalog(await runCommandOutput(command, ["ls", "--json"], signal));
      const resolved = resolveLmStudioInstalledModelOrNull(model, latestCatalog);
      if (resolved) return resolved;
      // A populated catalog conclusively means this chat's saved reference is
      // no longer present. Retry only the known transient empty-catalog state.
      if (latestCatalog.length > 0) break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
    if (Date.now() >= deadline) break;
    await wait(Math.min(LM_STUDIO_STARTUP_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())), signal);
  } while (Date.now() < deadline);

  return resolveLmStudioInstalledModel(model, latestCatalog);
}

async function runLmStudioServerCommand(command: string, args: string[], signal?: AbortSignal) {
  await execFileAsync(command, args, {
    signal,
    timeout: Math.max(5_000, daemonConfig.runtimeCommandTimeoutMs),
    windowsHide: true
  });
}

async function runLmStudioServerCommandForOutput(command: string, args: string[], signal?: AbortSignal) {
  const { stdout } = await execFileAsync(command, args, {
    signal,
    timeout: Math.max(5_000, daemonConfig.runtimeCommandTimeoutMs),
    windowsHide: true
  });
  return stdout;
}

async function waitFor(milliseconds: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("LM Studio runtime operation was aborted."));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function listLmStudioModels(
  {
    exists: pathExists = exists,
    inspectRuntime = inspectLmStudioRuntime,
    runCommandOutput = runLmStudioServerCommandForOutput,
    signal,
    wait = waitFor
  }: ListLmStudioModelsOptions = {}
): Promise<LmStudioInstalledModel[]> {
  const command = await requireLmStudioCommand(
    pathExists,
    inspectRuntime,
    wait,
    signal
  );

  const deadline = Date.now() + LM_STUDIO_MODEL_CATALOG_TIMEOUT_MS;
  let catalogWasRead = false;
  let latestModels: LmStudioInstalledModel[] = [];
  let lastError: Error | null = null;
  let knownModelCount: number | null = null;

  do {
    signal?.throwIfAborted();
    try {
      latestModels = parseLmStudioInstalledModels(
        await runCommandOutput(command, ["ls", "--json"], signal)
      );
      catalogWasRead = true;
      lastError = null;
      knownModelCount ??= (await inspectRuntime()).modelCount;
      if (latestModels.length > 0 && (
        knownModelCount === 0 || latestModels.length >= knownModelCount
      )) return latestModels;
      if (knownModelCount === 0) return [];
    } catch (error) {
      lastError = error instanceof Error
        ? error
        : new Error("LM Studio returned an unknown catalog error.");
      signal?.throwIfAborted();
    }

    if (Date.now() >= deadline) break;
    await wait(
      Math.min(LM_STUDIO_STARTUP_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())),
      signal
    );
  } while (Date.now() < deadline);

  if (!catalogWasRead && lastError) throw lastError;
  return latestModels;
}

async function listLoadedLmStudioModels(
  {
    exists: pathExists = exists,
    inspectRuntime = inspectLmStudioRuntime,
    runLoadedModelsOutput = runLmStudioServerCommandForOutput,
    signal,
    wait = waitFor
  }: Pick<
    ListLmStudioModelsOptions,
    "exists" | "inspectRuntime" | "runLoadedModelsOutput" | "signal" | "wait"
  > = {}
) {
  const command = await requireLmStudioCommand(
    pathExists,
    inspectRuntime,
    wait,
    signal
  );
  return parseLmStudioInstalledModels(await runLoadedModelsOutput(command, ["ps", "--json"], signal));
}

export async function getLmStudioModelReadiness(
  model: string,
  {
    exists: pathExists = exists,
    inspectRuntime = inspectLmStudioRuntime,
    runLoadedModelsOutput = runLmStudioServerCommandForOutput,
    signal
  }: Pick<PrepareLmStudioModelOptions, "exists" | "inspectRuntime" | "runLoadedModelsOutput" | "signal"> = {}
): Promise<LmStudioModelReadiness> {
  signal?.throwIfAborted();
  const runtime = await inspectRuntime();
  if (!runtime.running) return "server_off";

  const normalizedModel = model.trim();
  if (!normalizedModel) return "model_unloaded";
  const loadedModels = await listLoadedLmStudioModels({
    exists: pathExists,
    inspectRuntime,
    runLoadedModelsOutput,
    signal
  });
  return loadedModels.some((candidate) =>
    candidate.modelKey === normalizedModel ||
    candidate.path === normalizedModel ||
    candidate.displayName === normalizedModel
  ) ? "ready" : "model_unloaded";
}

export async function startLmStudioServer(
  {
    exists: pathExists = exists,
    inspectRuntime = inspectLmStudioRuntime,
    runCommand = runLmStudioServerCommand,
    signal,
    wait = waitFor
  }: StartLmStudioServerOptions = {}
): Promise<LmStudioServerStartResponse> {
  signal?.throwIfAborted();
  const runtime = await inspectRuntime();
  if (runtime.running) {
    return {
      alreadyRunning: true,
      runtime,
      startRequested: false
    };
  }

  const command = await requireLmStudioCommand(
    pathExists,
    inspectRuntime,
    wait,
    signal,
    runtime
  );

  let commandError: unknown = null;
  try {
    await runCommand(command, ["server", "start"], signal);
  } catch (error) {
    // LM Studio can detach its Local Server then exit its CLI with a non-zero
    // code while the server is still binding its port. Availability is the
    // authoritative outcome, so keep polling before surfacing the CLI error.
    commandError = error;
  }

  const startedRuntime = await waitForLmStudioRuntime(
    inspectRuntime,
    wait,
    LM_STUDIO_STARTUP_TIMEOUT_MS,
    signal
  );
  if (!startedRuntime?.running && commandError) {
    const detail = commandError instanceof Error && commandError.message.trim()
      ? ` ${commandError.message.trim()}`
      : "";
    throw new AppError("runtime_unavailable", `DeskCue could not start the LM Studio Local Server.${detail}`);
  }

  if (!startedRuntime) {
    throw new AppError("runtime_unavailable", "DeskCue could not verify that the LM Studio Local Server started.");
  }

  return {
    alreadyRunning: false,
    runtime: startedRuntime,
    startRequested: true
  };
}

export async function prepareLmStudioModel(
  model: string,
  {
    exists: pathExists = exists,
    inspectRuntime = inspectLmStudioRuntime,
    runCommand = runLmStudioServerCommand,
    runLoadedModelsOutput = runLmStudioServerCommandForOutput,
    runCommandOutput = runLmStudioServerCommandForOutput,
    signal,
    wait = waitFor,
    startServer = () => startLmStudioServer({
      exists: pathExists,
      inspectRuntime,
      runCommand,
      signal,
      wait
    })
  }: PrepareLmStudioModelOptions = {}
): Promise<LmStudioPrepareResponse> {
  signal?.throwIfAborted();
  const normalizedModel = model.trim();
  if (!normalizedModel) {
    throw new AppError("runtime_unavailable", "This LM Studio chat does not identify a model to load.");
  }

  const started = await startServer();
  const command = await requireLmStudioCommand(
    pathExists,
    inspectRuntime,
    wait,
    signal,
    started.runtime
  );

  const modelToLoad = await waitForLmStudioInstalledModel(
    normalizedModel,
    runCommandOutput,
    wait,
    signal
  );

  const alreadyLoaded = (await listLoadedLmStudioModels({
    exists: pathExists,
    inspectRuntime,
    runLoadedModelsOutput,
    signal,
    wait
  })).some((loadedModel) => loadedModel.modelKey === modelToLoad.modelKey && loadedModel.path === modelToLoad.path);
  let modelLoadError: unknown = null;
  if (!alreadyLoaded) {
    // The CLI's --exact flag applies to its local filesystem path, whereas
    // DeskCue sends the stable model key to LM Studio's OpenAI-compatible API.
    // Load only the exact catalogued path and retain that key as the API id.
    try {
      await runCommand(command, ["load", modelToLoad.path, "--exact", "--identifier", modelToLoad.modelKey, "--yes"], signal);
    } catch (error) {
      // Like `server start`, `lms load` can detach the actual model load and
      // exit non-zero while LM Studio keeps working. Treat the inspected model
      // state as authoritative before surfacing the CLI failure.
      modelLoadError = error;
    }
  }
  const runtime = await waitForLmStudioModel(
    inspectRuntime,
    wait,
    LM_STUDIO_MODEL_LOAD_TIMEOUT_MS,
    signal
  );
  if (runtime.loadedModelCount < 1) {
    const detail = modelLoadError instanceof Error && modelLoadError.message.trim()
      ? ` ${modelLoadError.message.trim()}`
      : "";
    throw new AppError(
      "runtime_unavailable",
      `LM Studio did not finish loading ${normalizedModel}.${detail}`
    );
  }
  if (modelLoadError) {
    const asynchronouslyLoaded = (await listLoadedLmStudioModels({
      exists: pathExists,
      inspectRuntime,
      runLoadedModelsOutput,
      signal,
      wait
    })).some((loadedModel) =>
      loadedModel.modelKey === modelToLoad.modelKey && loadedModel.path === modelToLoad.path
    );
    if (!asynchronouslyLoaded) {
      const detail = modelLoadError instanceof Error && modelLoadError.message.trim()
        ? ` ${modelLoadError.message.trim()}`
        : "";
      throw new AppError(
        "runtime_unavailable",
        `LM Studio did not confirm that ${normalizedModel} finished loading.${detail}`
      );
    }
  }

  return {
    ...started,
    model: modelToLoad,
    modelLoadRequested: !alreadyLoaded,
    runtime
  };
}
