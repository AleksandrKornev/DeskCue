import { spawn as spawnPty } from "@lydell/node-pty";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { SessionDetail, SessionStatus } from "@deskcue/protocol";

import {
  formatSessionPtySubmit,
  formatSessionProcessInput,
  getSessionProcessExitStatusOverride,
  isInteractiveSessionProcess
} from "./sessionProcessPolicy.ts";

type ChildSubscription = {
  dispose(): void;
};

export type RunningChild = {
  detachFromDeskCue?(): void;
  pid: number;
  surviveParentExit?: boolean;
  write(data: string): void;
  kill(signal?: NodeJS.Signals): void;
  onData(listener: (data: string) => void): ChildSubscription;
  onExit(listener: (event: { exitCode: number | null }) => void): ChildSubscription;
  transport?: "pipe" | "pty";
};

export type SessionSpawnSpec = {
  closeStdin?: boolean;
  file: string;
  args: string[];
  surviveParentExit?: boolean;
  transport?: "pipe" | "pty";
};

function unrefChildStream(stream: unknown) {
  const unref = (stream as { unref?: unknown } | null)?.unref;
  if (typeof unref === "function") {
    unref.call(stream);
  }
}

export function getExitedSessionStatus(
  session: Pick<SessionDetail, "adapterId" | "command" | "sourceSessionId" | "status">,
  exitCode: number | null
): SessionStatus {
  if (session.status === "stopped") {
    return "stopped";
  }

  const statusOverride = getSessionProcessExitStatusOverride(session, exitCode);
  if (statusOverride) return statusOverride;

  if (exitCode === 0) {
    return "done";
  }

  if (session.sourceSessionId && exitCode === null) {
    return "stopped";
  }

  return "failed";
}

function createWindowsCommandWrapper(command: string) {
  const directory = mkdtempSync(join(tmpdir(), "deskcue-command-"));
  const wrapperPath = join(directory, "run.cmd");
  writeFileSync(
    wrapperPath,
    `@echo off\r\n${command}\r\nexit /b %ERRORLEVEL%\r\n`,
    "utf8"
  );

  return wrapperPath;
}

function removeWindowsCommandWrapper(wrapperPath: string) {
  try {
    rmSync(dirname(wrapperPath), {
      force: true,
      recursive: true
    });
  } catch {
    // Best-effort cleanup only. The PTY session has already ended.
  }
}

export function forwardSessionActionDecision(child: RunningChild, decisionKey: string) {
  child.write(decisionKey === "\x1b" ? decisionKey : formatSessionPtySubmit(decisionKey));
}

export function forwardSessionInput(session: SessionDetail, child: RunningChild, input: string) {
  child.write(formatSessionProcessInput(session, input));
}

export function requestSessionPtyInterrupt(session: SessionDetail, child: RunningChild) {
  if (!isInteractiveSessionProcess(session.adapterId, session.command)) {
    return null;
  }

  child.write("\x1b");
  return "Escape";
}

function normalizeTerminalEnv(term: string | undefined) {
  return term && term !== "dumb" ? term : "xterm-256color";
}

export function buildSessionEnvironment(
  extraEnv: Record<string, string | undefined>,
  includeTerminal: boolean
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(includeTerminal ? { TERM: normalizeTerminalEnv(process.env.TERM) } : {}),
    ...extraEnv
  };

  // The optional DeskCue configuration variables are sourced from .env. Empty
  // values must behave as unset: some CLIs treat CLAUDE_CONFIG_DIR="" as the
  // current directory and then lose their normal credential/session location.
  for (const name of [
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "DESKCUE_CODEX_PATH",
    "DESKCUE_CODEX_MODEL"
  ]) {
    if (!env[name]?.trim()) {
      delete env[name];
    }
  }

  return env;
}

export function createSessionPty(
  command: string,
  cwd: string,
  extraEnv: Record<string, string | undefined>,
  spawnSpec?: SessionSpawnSpec
): RunningChild {
  const env = buildSessionEnvironment(extraEnv, true);

  if (spawnSpec) {
    return spawnPty(spawnSpec.file, spawnSpec.args, {
      name: "xterm-color",
      cols: 120,
      rows: 30,
      cwd,
      env,
      useConpty: true,
      useConptyDll: false
    });
  }

  if (process.platform === "win32") {
    const shell = env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
    const wrapperPath = createWindowsCommandWrapper(command);
    const child = spawnPty(shell, ["/d", "/c", wrapperPath], {
      name: "xterm-color",
      cols: 120,
      rows: 30,
      cwd,
      env,
      useConpty: true,
      useConptyDll: false
    });
    child.onExit(() => {
      removeWindowsCommandWrapper(wrapperPath);
    });

    return child;
  }

  const shell = env.SHELL || "/bin/bash";
  return spawnPty(shell, ["-lc", command], {
    name: "xterm-color",
    cols: 120,
    rows: 30,
    cwd,
    env
  });
}

// Print-mode CLIs must not inherit a terminal: Claude changes its resume lookup
// behavior when it sees a PTY, while its normal pipe mode persists the same chat.
export function createSessionPipe(
  cwd: string,
  extraEnv: Record<string, string | undefined>,
  spawnSpec: SessionSpawnSpec
): RunningChild {
  const env = buildSessionEnvironment(extraEnv, false);
  const child = spawn(spawnSpec.file, spawnSpec.args, {
    cwd,
    detached: spawnSpec.surviveParentExit || process.platform !== "win32",
    env,
    shell: false,
    stdio: spawnSpec.surviveParentExit ? "ignore" : "pipe",
    windowsHide: true
  });
  const dataHandlers = new Set<(chunk: string) => void>();
  const exitHandlers = new Set<(event: { exitCode: number | null }) => void>();
  const pendingData: string[] = [];
  let detachedFromDeskCue = false;
  let exited = false;
  let finalExitCode: number | null = null;

  const publishData = (value: Buffer | string) => {
    if (detachedFromDeskCue) {
      return;
    }
    const text = value.toString();
    if (dataHandlers.size === 0) {
      pendingData.push(text);
      return;
    }
    for (const handler of dataHandlers) {
      handler(text);
    }
  };
  const publishExit = (exitCode: number | null) => {
    if (exited) {
      return;
    }
    exited = true;
    finalExitCode = exitCode;
    for (const handler of exitHandlers) {
      handler({ exitCode });
    }
  };

  child.stdout?.on("data", publishData);
  child.stderr?.on("data", publishData);
  child.once("error", (error) => {
    publishData(`Failed to start process: ${error.message}\n`);
    publishExit(1);
  });
  // `close` waits for stdio handles too. CLI hooks may outlive the parent
  // process while retaining those handles, which left a completed one-shot
  // agent session permanently "running". The parent `exit` is the lifecycle
  // signal that matters for a managed process.
  child.once("exit", (exitCode) => publishExit(exitCode));
  if (spawnSpec.closeStdin) {
    child.stdin?.end();
  }

  return {
    detachFromDeskCue() {
      detachedFromDeskCue = true;
      dataHandlers.clear();
      exitHandlers.clear();
      pendingData.length = 0;
      child.unref();
      unrefChildStream(child.stdin);
      unrefChildStream(child.stdout);
      unrefChildStream(child.stderr);
    },
    pid: child.pid ?? -1,
    surviveParentExit: spawnSpec.surviveParentExit === true,
    transport: "pipe",
    write(value: string) {
      child.stdin?.write(value);
    },
    kill(signal) {
      child.kill(signal);
    },
    onData(handler) {
      dataHandlers.add(handler);
      for (const chunk of pendingData.splice(0)) {
        handler(chunk);
      }
      return {
        dispose: () => dataHandlers.delete(handler)
      };
    },
    onExit(handler) {
      exitHandlers.add(handler);
      if (exited) {
        handler({ exitCode: finalExitCode });
      }
      return {
        dispose: () => exitHandlers.delete(handler)
      };
    }
  };
}
