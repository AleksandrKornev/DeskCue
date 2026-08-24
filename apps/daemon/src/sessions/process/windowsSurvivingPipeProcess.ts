import { spawn } from "node:child_process";

import { SessionProcessEventRelay } from "./sessionProcessEventRelay.ts";
import { WindowsSurvivingPipeHandshake } from "./windows/windowsSurvivingPipeHandshake.ts";
import { createWindowsSurvivingPipeLauncher } from "./windowsSurvivingPipeLauncher.ts";

type WindowsSurvivingPipeSpawnSpec = {
  args: string[];
  file: string;
};

function unrefChildStream(stream: unknown) {
  const unref = (stream as { unref?: unknown } | null)?.unref;

  if (typeof unref === "function") unref.call(stream);
}

export function createWindowsSurvivingSessionPipe(
  cwd: string,
  env: NodeJS.ProcessEnv,
  spawnSpec: WindowsSurvivingPipeSpawnSpec
) {
  const launcher = createWindowsSurvivingPipeLauncher(spawnSpec);
  const child = spawn(launcher.file, launcher.args, {
    cwd,
    detached: true,
    env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe", "pipe"],
    windowsHide: true
  });
  const events = new SessionProcessEventRelay();
  const handshake = new WindowsSurvivingPipeHandshake(child, events);

  child.stdout?.on("data", (value: Buffer) => events.publishData(value, "stdout"));
  child.stderr?.on("data", (value: Buffer) => events.publishData(value, "stderr"));
  handshake.start(launcher.payload);

  return {
    detachFromDeskCue() {
      events.detach();
      child.unref();
      unrefChildStream(child.stdin);
      unrefChildStream(child.stdout);
      unrefChildStream(child.stderr);
      unrefChildStream(child.stdio[3]);
    },
    pid: child.pid ?? -1,
    startupReady: handshake.startupReady,
    surviveParentExit: true,
    transport: "pipe" as const,
    write(value: string) {
      if (!child.stdin || child.stdin.destroyed || child.stdin.writableEnded) return;

      child.stdin.write(value, () => undefined);
    },
    kill(signal?: NodeJS.Signals) {
      handshake.kill(signal);
    },
    onData(handler: Parameters<SessionProcessEventRelay["onData"]>[0]) {
      return events.onData(handler);
    },
    onExit(handler: (event: { exitCode: number | null }) => void) {
      return events.onExit(handler);
    }
  };
}
