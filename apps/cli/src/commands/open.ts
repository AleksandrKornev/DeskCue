import { spawn } from "node:child_process";

import type { HostRequest } from "../host/hostClient.ts";
import type { LaunchHost } from "../host/hostLauncher.ts";
import { startDeskCue } from "./start.ts";

type OpenUrl = (url: string) => Promise<void>;

function validateDashboardUrl(value: string) {
  const url = new URL(value);
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";

  if (url.protocol !== "http:" || !isLoopback || url.username || url.password) {
    throw new Error("DeskCue Host returned an invalid local dashboard URL.");
  }

  return url.toString();
}

export function openExternalUrl(url: string): Promise<void> {
  const command = process.platform === "win32"
    ? { args: [url], file: "explorer.exe" }
    : process.platform === "darwin"
      ? { args: [url], file: "open" }
      : { args: [url], file: "xdg-open" };

  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });

    child.once("error", reject);

    child.once("spawn", () => {
      child.removeListener("error", reject);
      child.unref();
      resolve();
    });
  });
}

export async function openDeskCue({
  launch,
  openUrl = openExternalUrl,
  printOnly,
  request
}: {
  launch?: LaunchHost;
  openUrl?: OpenUrl;
  printOnly: boolean;
  request: HostRequest;
}) {
  const status = await startDeskCue(request, launch);

  if (!status.daemon.baseUrl) {
    throw new Error("DeskCue daemon started without a dashboard URL.");
  }

  const url = validateDashboardUrl(status.daemon.baseUrl);

  if (!printOnly) await openUrl(url);

  return { status, url };
}
