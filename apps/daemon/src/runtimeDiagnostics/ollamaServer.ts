import { spawn } from "node:child_process";
import path from "node:path";

import type { OllamaServerStartResponse } from "@deskcue/protocol";
import { AppError } from "#application/errors";

import { inspectOllamaRuntime } from "./ollama.ts";
import { commandExists, exists } from "./shared.ts";

type StartOllamaServerOptions = {
  commandExists?: typeof commandExists;
  exists?: typeof exists;
  inspectRuntime?: typeof inspectOllamaRuntime;
  launchServer?: (command: string) => Promise<void>;
  signal?: AbortSignal;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

const OLLAMA_STARTUP_TIMEOUT_MS = 15_000;
const OLLAMA_STARTUP_POLL_INTERVAL_MS = 500;
const OLLAMA_WINDOWS_BIN = path.join(
  process.env.LOCALAPPDATA ?? "",
  "Programs",
  "Ollama",
  "ollama.exe"
);

async function waitFor(milliseconds: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Ollama startup was aborted."));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function resolveOllamaCommand(
  pathExists: typeof exists,
  commandIsAvailable: typeof commandExists
) {
  if (process.platform === "win32" && await pathExists(OLLAMA_WINDOWS_BIN)) {
    return OLLAMA_WINDOWS_BIN;
  }
  return await commandIsAvailable("ollama") ? "ollama" : null;
}

function launchOllamaServer(command: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    const onError = (error: Error) => reject(error);
    child.once("error", onError);
    child.once("spawn", () => {
      child.off("error", onError);
      child.unref();
      resolve();
    });
  });
}

export async function startOllamaServer({
  commandExists: commandIsAvailable = commandExists,
  exists: pathExists = exists,
  inspectRuntime = inspectOllamaRuntime,
  launchServer = launchOllamaServer,
  signal,
  wait = waitFor
}: StartOllamaServerOptions = {}): Promise<OllamaServerStartResponse> {
  signal?.throwIfAborted();
  const runtime = await inspectRuntime();
  if (runtime.running) {
    return {
      alreadyRunning: true,
      runtime,
      startRequested: false
    };
  }

  const command = await resolveOllamaCommand(pathExists, commandIsAvailable);
  if (!runtime.installed || !command) {
    throw new AppError("runtime_unavailable", "Ollama is not installed on this machine.");
  }

  try {
    await launchServer(command);
  } catch (error) {
    const detail = error instanceof Error && error.message.trim()
      ? ` ${error.message.trim()}`
      : "";
    throw new AppError("runtime_unavailable", `DeskCue could not start Ollama.${detail}`);
  }

  const deadline = Date.now() + OLLAMA_STARTUP_TIMEOUT_MS;
  let startedRuntime = runtime;
  while (!startedRuntime.running && Date.now() < deadline) {
    signal?.throwIfAborted();
    await wait(
      Math.min(OLLAMA_STARTUP_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())),
      signal
    );
    startedRuntime = await inspectRuntime();
  }

  if (!startedRuntime.running) {
    throw new AppError(
      "runtime_unavailable",
      "Ollama did not become available after DeskCue started it."
    );
  }

  return {
    alreadyRunning: false,
    runtime: startedRuntime,
    startRequested: true
  };
}
