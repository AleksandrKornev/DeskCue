import type { HostStatus } from "@deskcue/host-control";

import { assertHostCapability, readOptionalHostStatus } from "../host/hostClient.ts";
import type { HostRequest } from "../host/hostClient.ts";

export async function stopDeskCue(request: HostRequest) {
  const initial = await readOptionalHostStatus(request);

  if (!initial || initial.daemon.state === "stopped") return initial;

  assertHostCapability(initial, "daemon.stop");

  return request("daemon.stop");
}

export function formatStopMessage(status: HostStatus | null) {
  if (!status) return "DeskCue Host and daemon are not running.";

  return status.daemon.state === "stopped"
    ? "DeskCue daemon is stopped. The Host remains running."
    : `DeskCue daemon is ${status.daemon.state}. The Host remains ${status.host.state}.`;
}
