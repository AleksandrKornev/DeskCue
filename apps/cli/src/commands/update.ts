import { assertHostCapability } from "../host/hostClient.ts";
import type { HostRequest } from "../host/hostClient.ts";
import type { LaunchHost } from "../host/hostLauncher.ts";
import { ensureHostRunning } from "../host/hostLauncher.ts";
import type { UpdateChannel } from "../args.ts";
import { sanitizeTerminalLine } from "../output.ts";

const UPDATE_FEED_NOT_FOUND_PATTERN = /^Update source returned HTTP 404\.$/u;

export function formatUpdateError(message: string) {
  return UPDATE_FEED_NOT_FOUND_PATTERN.test(message)
    ? "The requested update resource was not found (HTTP 404). No update was installed."
    : sanitizeTerminalLine(message);
}

export async function updateDeskCue({
  channel,
  check,
  launch,
  request
}: {
  channel: UpdateChannel | null;
  check: boolean;
  launch?: LaunchHost;
  request: HostRequest;
}) {
  const initial = await ensureHostRunning(request, launch);
  const params = channel ? { channel } : undefined;

  assertHostCapability(initial, "update.check");

  const checked = await request("update.check", params);

  if (check || !checked.update.availableVersion) return checked;

  assertHostCapability(checked, "update.apply");

  return request("update.apply", {
    ...(channel ? { channel } : {}),
    version: checked.update.availableVersion
  });
}

export function formatUpdateMessage(status: Awaited<ReturnType<typeof updateDeskCue>>, check: boolean) {
  if (status.update.state === "failed") {
    return status.update.lastError
      ? `DeskCue update failed: ${formatUpdateError(status.update.lastError)}`
      : "DeskCue update failed.";
  }

  if (status.update.availableVersion) {
    const version = sanitizeTerminalLine(status.update.availableVersion);

    if (check) return `DeskCue ${version} is available.`;

    if (status.update.state === "downloading") {
      return `DeskCue is downloading update ${version}.`;
    }

    if (status.update.state === "staged") {
      return `DeskCue update ${version} is staged and ready to install.`;
    }

    if (status.update.state === "applying") {
      return `DeskCue is applying update ${version}.`;
    }

    return `DeskCue update ${version} is ${status.update.state}.`;
  }

  if (status.update.state === "checking") return "DeskCue is checking for updates.";
  if (status.update.state === "downloading") return "DeskCue is downloading an update.";
  if (status.update.state === "staged") return "A DeskCue update is staged and ready to apply.";
  if (status.update.state === "applying") return "DeskCue is applying an update.";

  return "DeskCue is up to date.";
}
