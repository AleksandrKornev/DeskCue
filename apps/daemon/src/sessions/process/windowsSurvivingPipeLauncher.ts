import { spawn } from "node:child_process";
import { closeSync, writeSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WINDOWS_LAUNCH_DIAGNOSTIC_MAX_LENGTH = 2_048;

export type WindowsSurvivingPipeLauncher = {
  args: string[];
  file: string;
  payload: string;
};

type WindowsSurvivingPipePayload = {
  args: string[];
  file: string;
};

type WindowsLauncherControlMessage = {
  diagnostic?: string;
  pid?: number;
  status: "error" | "ready";
};

function createDiscardRemainingOutput(
  source: NodeJS.ReadableStream,
  destination: NodeJS.WriteStream
) {
  return () => {
    source.unpipe(destination);
    source.resume();
  };
}

function createRemoveDestinationErrorHandler(
  destination: NodeJS.WriteStream,
  discardRemainingOutput: () => void
) {
  return () => destination.off("error", discardRemainingOutput);
}

function relayChildOutput(
  source: NodeJS.ReadableStream | null,
  destination: NodeJS.WriteStream
) {
  if (!source) return;

  const discardRemainingOutput = createDiscardRemainingOutput(source, destination);
  const removeDestinationErrorHandler = createRemoveDestinationErrorHandler(
    destination,
    discardRemainingOutput
  );

  destination.once("error", discardRemainingOutput);
  source.once("close", removeDestinationErrorHandler);
  source.pipe(destination, { end: false });
}

function getSafeErrorProperty(error: unknown, property: "code" | "syscall") {
  const value = (error as Record<string, unknown> | null)?.[property];

  return typeof value === "string" ? value : null;
}

class WindowsSurvivingPipeLauncherRuntime {
  private controlSent = false;
  private payload = "";

  private sendControl(message: WindowsLauncherControlMessage) {
    if (this.controlSent) return;

    this.controlSent = true;

    try {
      writeSync(3, `${JSON.stringify(message)}\n`);
    } catch {
      // The DeskCue parent may have exited after the nested process started.
    }

    try {
      closeSync(3);
    } catch {
      // The control descriptor may already be closed after a failed write.
    }
  }

  private readonly fail = (error: unknown): never => {
    const code = getSafeErrorProperty(error, "code") ?? "UNKNOWN";
    const syscall = getSafeErrorProperty(error, "syscall")
      ?.trim()
      .split(/\s+/, 1)[0] ?? "spawn";
    const diagnostic = `Failed to start process: ${code} (${syscall})`
      .replace(/[\r\n]+/g, " ")
      .slice(0, WINDOWS_LAUNCH_DIAGNOSTIC_MAX_LENGTH);

    this.sendControl({ diagnostic, status: "error" });
    process.exit(1);
  };

  private readonly appendPayload = (chunk: Buffer | string) => {
    this.payload += chunk.toString();
  };

  private readonly launchFromPayload = () => {
    let spec: WindowsSurvivingPipePayload;

    try {
      spec = JSON.parse(this.payload) as WindowsSurvivingPipePayload;
    } catch (error) {
      this.fail(error);
      return;
    }

    this.payload = "";

    const child = spawn(spec.file, spec.args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    relayChildOutput(child.stdout, process.stdout);
    relayChildOutput(child.stderr, process.stderr);
    child.once("error", this.fail);

    child.once("spawn", () => {
      this.payload = "";
      this.sendControl({ pid: child.pid, status: "ready" });
    });
    child.once("close", (exitCode) => {
      process.exitCode = exitCode ?? 1;
    });
  };

  start() {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", this.appendPayload);
    process.stdin.once("error", this.fail);
    process.stdin.once("end", this.launchFromPayload);
  }
}

function runWindowsSurvivingPipeLauncher() {
  const runtime = new WindowsSurvivingPipeLauncherRuntime();

  runtime.start();
}

function isDirectExecution() {
  const entryPath = process.argv[1];

  if (!entryPath) return false;

  return pathToFileURL(entryPath).href === import.meta.url;
}

export function createWindowsSurvivingPipeLauncher(
  spec: WindowsSurvivingPipePayload
): WindowsSurvivingPipeLauncher {
  const launcherPath = fileURLToPath(import.meta.url);
  const runtimeArgs = launcherPath.endsWith(".ts")
    ? ["--import", import.meta.resolve("tsx")]
    : [];

  return {
    args: [...runtimeArgs, launcherPath],
    file: process.execPath,
    payload: JSON.stringify(spec)
  };
}

if (isDirectExecution()) runWindowsSurvivingPipeLauncher();
