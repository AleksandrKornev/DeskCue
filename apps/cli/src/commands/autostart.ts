import { assertHostCapability } from "../host/hostClient.ts";
import type { HostRequest } from "../host/hostClient.ts";
import type { LaunchHost } from "../host/hostLauncher.ts";
import { ensureHostRunning } from "../host/hostLauncher.ts";
import type { AutostartAction } from "../args.ts";

const actionMethods = {
  disable: "autostart.disable",
  enable: "autostart.enable",
  status: "autostart.get"
} as const;

export async function updateAutostart(
  request: HostRequest,
  action: AutostartAction,
  launch?: LaunchHost
) {
  const status = await ensureHostRunning(request, launch);
  const method = actionMethods[action];

  assertHostCapability(status, method);

  return request(method);
}

export function formatAutostartMessage(status: Awaited<ReturnType<typeof updateAutostart>>) {
  if (!status.autostart.supported) return "DeskCue autostart is not supported on this platform.";
  if (status.autostart.enabled === null) return "DeskCue autostart state is unknown.";

  return `DeskCue autostart is ${status.autostart.enabled ? "enabled" : "disabled"}.`;
}
