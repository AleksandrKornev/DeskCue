import { spawn } from "node:child_process";

import { SessionProcessEventRelay } from "../sessionProcessEventRelay.ts";
import { WINDOWS_LAUNCH_DIAGNOSTIC_MAX_LENGTH } from "../windowsSurvivingPipeLauncher.ts";

type LauncherChild = ReturnType<typeof spawn>;

type WindowsLauncherControlMessage = {
  diagnostic?: string;
  pid?: number;
  status: "error" | "ready";
};

function boundWindowsLaunchDiagnostic(value: string) {
  return value
    .replace(/[\r\n]+/g, " ")
    .slice(0, WINDOWS_LAUNCH_DIAGNOSTIC_MAX_LENGTH);
}

function getSafeErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;

  return typeof code === "string" ? code : "UNKNOWN";
}

class WindowsProcessTreeTerminator {
  private descendantTerminationFinished = false;
  private usedFallback = false;

  constructor(
    private readonly child: LauncherChild,
    private readonly signal?: NodeJS.Signals,
    private readonly descendantPid?: number
  ) {}

  private killDirectChild() {
    try {
      this.child.kill(this.signal);
    } catch {
      // The process may have exited between taskkill and the fallback.
    }
  }

  private readonly finishFallback = () => {
    if (this.descendantTerminationFinished) return;

    this.descendantTerminationFinished = true;
    this.killDirectChild();
  };

  private readonly fallback = () => {
    if (this.usedFallback) return;

    this.usedFallback = true;
    if (!this.descendantPid || this.descendantPid === this.child.pid) {
      this.killDirectChild();
      return;
    }

    const descendantTerminator = spawn(
      "taskkill.exe",
      ["/pid", String(this.descendantPid), "/t", "/f"],
      { shell: false, stdio: "ignore", windowsHide: true }
    );

    descendantTerminator.once("error", this.finishFallback);
    descendantTerminator.once("exit", this.finishFallback);
    descendantTerminator.unref();
  };

  private readonly finishPrimaryTermination = (exitCode: number | null) => {
    if (exitCode !== 0) this.fallback();
  };

  start() {
    if (!this.child.pid) {
      this.child.kill(this.signal);
      return;
    }

    const terminator = spawn(
      "taskkill.exe",
      ["/pid", String(this.child.pid), "/t", "/f"],
      { shell: false, stdio: "ignore", windowsHide: true }
    );

    terminator.once("error", this.fallback);
    terminator.once("exit", this.finishPrimaryTermination);
    terminator.unref();
  }
}

function terminateWindowsProcessTree(
  child: LauncherChild,
  signal?: NodeJS.Signals,
  descendantPid?: number
) {
  const terminator = new WindowsProcessTreeTerminator(child, signal, descendantPid);

  terminator.start();
}

export class WindowsSurvivingPipeHandshake {
  readonly startupReady: Promise<void>;

  private controlBuffer = "";
  private controlMessageReceived = false;
  private descendantPid: number | undefined;
  private rejectStartupReady: ((error: Error) => void) | undefined;
  private resolveStartupReady: (() => void) | undefined;
  private startupSettled = false;

  constructor(
    private readonly child: LauncherChild,
    private readonly events: SessionProcessEventRelay
  ) {
    this.startupReady = new Promise<void>((resolve, reject) => {
      this.resolveStartupReady = resolve;
      this.rejectStartupReady = reject;
    });

    void this.startupReady.catch(() => undefined);
  }

  start(payload: string) {
    const controlStream = this.child.stdio[3] as NodeJS.ReadableStream | null;

    controlStream?.on("data", (chunk: Buffer | string) => {
      this.receiveControlChunk(chunk);
    });
    controlStream?.once("error", (error) => {
      this.rejectProtocol(
        `Failed to read process launcher response: ${getSafeErrorCode(error)}`
      );
    });
    controlStream?.once("end", () => {
      this.finishControlStream();
    });
    this.child.once("error", (error) => {
      this.rejectStartup(
        `Failed to start process launcher: ${getSafeErrorCode(error)}`
      );

      this.events.publishExit(1);
    });
    this.child.once("close", (exitCode) => {
      this.handleLauncherClose(exitCode);
    });
    this.child.stdin?.once("error", (error) => {
      this.rejectProtocol(
        `Failed to deliver process startup payload: ${getSafeErrorCode(error)}`
      );
    });

    try {
      this.child.stdin?.end(payload);
    } catch (error) {
      this.rejectProtocol(
        `Failed to deliver process startup payload: ${getSafeErrorCode(error)}`
      );
    }
  }

  kill(signal?: NodeJS.Signals) {
    terminateWindowsProcessTree(this.child, signal, this.descendantPid);
  }

  private receiveControlChunk(chunk: Buffer | string) {
    if (this.controlMessageReceived) return;

    this.controlBuffer += chunk.toString();
    if (this.controlBuffer.length > WINDOWS_LAUNCH_DIAGNOSTIC_MAX_LENGTH * 2) {
      this.rejectProtocol("Failed to start process: oversized launcher response");
      return;
    }

    const newlineIndex = this.controlBuffer.indexOf("\n");

    if (newlineIndex >= 0) {
      this.receiveControlMessage(this.controlBuffer.slice(0, newlineIndex));
      this.controlBuffer = "";
    }
  }

  private receiveControlMessage(rawMessage: string) {
    if (this.controlMessageReceived) return;

    this.controlMessageReceived = true;
    let message: WindowsLauncherControlMessage;

    try {
      message = JSON.parse(rawMessage) as WindowsLauncherControlMessage;
    } catch {
      this.rejectProtocol("Failed to start process: invalid launcher response");
      return;
    }

    if (message.status === "ready") {
      this.acceptReadyMessage(message.pid);
      return;
    }

    if (message.status === "error" && typeof message.diagnostic === "string") {
      this.rejectStartup(message.diagnostic);
      return;
    }

    this.rejectProtocol("Failed to start process: invalid launcher response");
  }

  private acceptReadyMessage(pid: number | undefined) {
    if (!Number.isInteger(pid) || (pid ?? 0) <= 0) {
      this.rejectProtocol("Failed to start process: invalid launcher process identity");
      return;
    }

    this.descendantPid = pid;
    this.resolveStartup();
  }

  private finishControlStream() {
    if (!this.controlMessageReceived && this.controlBuffer.trim()) {
      this.receiveControlMessage(this.controlBuffer.trim());
    }

    if (!this.startupSettled) {
      this.rejectStartup(
        "Failed to start process: launcher closed before readiness confirmation"
      );
    }
  }

  private handleLauncherClose(exitCode: number | null) {
    if (!this.startupSettled) {
      this.rejectStartup(
        "Failed to start process: launcher exited before readiness confirmation"
      );
    }

    this.events.publishExit(exitCode);
  }

  private resolveStartup() {
    if (this.startupSettled) return;

    this.startupSettled = true;
    this.resolveStartupReady?.();
  }

  private rejectStartup(diagnostic: string) {
    if (this.startupSettled) return;

    this.startupSettled = true;
    const boundedDiagnostic = boundWindowsLaunchDiagnostic(diagnostic);

    this.events.publishData(`${boundedDiagnostic}\n`);

    this.rejectStartupReady?.(new Error(boundedDiagnostic));
  }

  private rejectProtocol(diagnostic: string) {
    if (this.startupSettled) return;

    this.rejectStartup(diagnostic);
    this.kill();
  }
}
