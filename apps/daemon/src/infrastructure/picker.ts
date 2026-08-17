import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { PickWorkspaceResult } from "@deskcue/protocol";
import { AppError } from "#application/errors";

import { logger } from "./logging/logger.ts";

const execFileAsync = promisify(execFile);

function normalizePickerOutput(rawPath: string): PickWorkspaceResult {
  const path = rawPath.trim();
  return {
    cancelled: path.length === 0,
    path: path || null
  };
}

async function pickWindowsFolder(): Promise<PickWorkspaceResult> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'DeskCue'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.StartPosition = 'CenterScreen'
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Opacity = 0
$null = $owner.Show()
$owner.Activate()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose a DeskCue workspace'
$dialog.ShowNewFolderButton = $false
$result = $dialog.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
`;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", script],
      {
        timeout: 120000,
        windowsHide: false
      }
    );

    const result = normalizePickerOutput(stdout);
    logger.info("Native workspace picker completed", {
      cancelled: result.cancelled,
      path: result.path
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace picker failed.";
    logger.error("Native workspace picker failed", {
      message
    });
    throw new AppError(
      "runtime_unavailable",
      `${message} The native folder picker may be blocked or hidden. Try again or enter the path manually.`
    );
  }
}

async function pickMacFolder(): Promise<PickWorkspaceResult> {
  const script =
    'try\n' +
    'set chosenFolder to choose folder with prompt "Choose a DeskCue workspace"\n' +
    'POSIX path of chosenFolder\n' +
    'on error number -128\n' +
    'return ""\n' +
    'end try';

  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  const result = normalizePickerOutput(stdout);
  logger.info("Native workspace picker completed", {
    cancelled: result.cancelled,
    path: result.path
  });
  return result;
}

async function pickLinuxFolder(): Promise<PickWorkspaceResult> {
  try {
    const { stdout } = await execFileAsync("zenity", [
      "--file-selection",
      "--directory",
      "--title=Choose a DeskCue workspace"
    ]);
    const result = normalizePickerOutput(stdout);
    logger.info("Native workspace picker completed", {
      cancelled: result.cancelled,
      path: result.path
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Directory picker is unavailable.";
    logger.error("Native workspace picker failed", {
      message
    });
    throw new AppError(
      "runtime_unavailable",
      `${message} Install zenity or enter the workspace path manually.`
    );
  }
}

export async function pickWorkspacePath(): Promise<PickWorkspaceResult> {
  logger.info("Opening native workspace picker", {
    platform: process.platform
  });
  switch (process.platform) {
    case "win32":
      return pickWindowsFolder();
    case "darwin":
      return pickMacFolder();
    default:
      return pickLinuxFolder();
  }
}
