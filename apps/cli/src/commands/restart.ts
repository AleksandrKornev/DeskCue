import { assertHostCapability } from "../host/hostClient.ts";
import type { HostRequest } from "../host/hostClient.ts";
import type { LaunchHost } from "../host/hostLauncher.ts";
import { ensureHostRunning } from "../host/hostLauncher.ts";

export async function restartDeskCue(
  request: HostRequest,
  launch?: LaunchHost
) {
  const initial = await ensureHostRunning(request, launch);

  assertHostCapability(initial, "daemon.restart");

  return request("daemon.restart");
}

export function formatRestartMessage(status: Awaited<ReturnType<typeof restartDeskCue>>) {
  const url = status.daemon.baseUrl ? ` at ${status.daemon.baseUrl}` : "";

  return status.daemon.state === "running"
    ? `DeskCue daemon restarted${url}. The Host remained running.`
    : `DeskCue Host is running, but the daemon restart ended in ${status.daemon.state}.`;
}
