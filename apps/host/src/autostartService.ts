import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import type { HostStatus } from "@deskcue/host-control";

import { HostOperationError } from "./hostOperationError.ts";

const AUTOSTART_REGISTRY_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const AUTOSTART_VALUE_NAME = "DeskCue";
const LINUX_AUTOSTART_SERVICE = "deskcue-host.service";
const WINDOWS_REGISTRY_EXECUTABLE = join(
  process.env.SystemRoot?.trim() || process.env.WINDIR?.trim() || "C:\\Windows",
  "System32",
  "reg.exe"
);
const execFileAsync = promisify(execFile);

type RegistryResult = { stdout: string };
type RunRegistry = (arguments_: string[]) => Promise<RegistryResult>;
type SystemctlResult = { stdout: string };
type RunSystemctl = (arguments_: string[]) => Promise<SystemctlResult>;

type HostAutostartServiceOptions = {
  env?: NodeJS.ProcessEnv;
  hostEntryPath?: string;
  platform?: NodeJS.Platform;
  runRegistry?: RunRegistry;
  runSystemctl?: RunSystemctl;
  trayExecutablePath?: string;
};

function createRegistryRunner(): RunRegistry {
  return async (arguments_) => {
    const result = await execFileAsync(WINDOWS_REGISTRY_EXECUTABLE, arguments_, {
      encoding: "utf8",
      windowsHide: true
    });

    return { stdout: result.stdout };
  };
}

function createSystemctlRunner(): RunSystemctl {
  return async (arguments_) => {
    const result = await execFileAsync("systemctl", arguments_, { encoding: "utf8" });

    return { stdout: result.stdout };
  };
}

type ConfiguredRegistryValue = {
  command: string;
  type: string;
};

function readConfiguredValue(stdout: string): ConfiguredRegistryValue | null {
  const valueLine = stdout.split(/\r?\n/u).find((line) => /\sDeskCue\s+REG_[A-Z_]+\s*/iu.test(line));

  if (!valueLine) return null;

  const match = /^\s*DeskCue\s+(REG_[A-Z_]+)\s*(.*)$/iu.exec(valueLine);

  return match ? { command: match[2]?.trim() ?? "", type: match[1]! } : null;
}

function isMissingRegistryValue(error: unknown) {
  return (error as { code?: unknown } | null)?.code === 1;
}

function isDisabledSystemdUnit(error: unknown) {
  return (error as { code?: unknown } | null)?.code === 1;
}

function toAutostartError(error: unknown) {
  if (error instanceof HostOperationError) return error;

  return new HostOperationError(
    "autostart_registry_failed",
    `Windows could not update DeskCue autostart: ${error instanceof Error ? error.message : String(error)}`
  );
}

function toSystemdAutostartError(error: unknown) {
  if (error instanceof HostOperationError) return error;

  return new HostOperationError(
    "autostart_systemd_failed",
    `Linux could not update DeskCue autostart: ${error instanceof Error ? error.message : String(error)}`
  );
}

export function resolveTrayExecutablePath({
  env = process.env,
  hostEntryPath = process.argv[1],
  trayExecutablePath
}: Pick<HostAutostartServiceOptions, "env" | "hostEntryPath" | "trayExecutablePath"> = {}) {
  if (trayExecutablePath) return resolve(trayExecutablePath);
  if (env.DESKCUE_TRAY_EXECUTABLE?.trim()) return resolve(env.DESKCUE_TRAY_EXECUTABLE.trim());
  if (env.DESKCUE_INSTALL_DIR?.trim()) return resolve(env.DESKCUE_INSTALL_DIR.trim(), "DeskCue.Tray.exe");

  return resolve(dirname(hostEntryPath), "../../../..", "DeskCue.Tray.exe");
}

export class HostAutostartService {
  private configuredValue: ConfiguredRegistryValue | null = null;
  private enabled: boolean | null = null;
  private readonly expectedCommand: string;
  private readonly platform: NodeJS.Platform;
  private readonly runRegistry: RunRegistry;
  private readonly runSystemctl: RunSystemctl;
  readonly supported: boolean;

  constructor(options: HostAutostartServiceOptions = {}) {
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const trayExecutablePath = resolveTrayExecutablePath({ ...options, env });
    const installedMode = env.DESKCUE_DISTRIBUTION_MODE === "installed";

    if (trayExecutablePath.includes('"')) throw new Error("DeskCue tray path cannot contain a quote.");

    this.expectedCommand = `"${trayExecutablePath}" --autostart`;
    this.platform = platform;
    this.runRegistry = options.runRegistry ?? createRegistryRunner();
    this.runSystemctl = options.runSystemctl ?? createSystemctlRunner();
    this.supported = installedMode && (
      (platform === "win32" && (Boolean(options.runRegistry) || existsSync(trayExecutablePath))) ||
      (platform === "linux" && (
        Boolean(options.runSystemctl) || env.DESKCUE_HOST_LAUNCH_MODE === "systemd-user"
      ))
    );
  }

  get status(): HostStatus["autostart"] {
    return {
      enabled: this.supported ? this.enabled : null,
      supported: this.supported
    };
  }

  async refresh() {
    this.assertSupported();

    if (this.platform === "linux") return this.refreshSystemd();

    try {
      const result = await this.runRegistry([
        "query",
        AUTOSTART_REGISTRY_KEY,
        "/v",
        AUTOSTART_VALUE_NAME
      ]);

      this.configuredValue = readConfiguredValue(result.stdout);
      this.enabled = this.configuredValue?.type === "REG_SZ" &&
        this.configuredValue.command.toLowerCase() === this.expectedCommand.toLowerCase();
    } catch (error) {
      if (!isMissingRegistryValue(error)) throw toAutostartError(error);

      this.configuredValue = null;
      this.enabled = false;
    }

    return this.status;
  }

  async setEnabled(enabled: boolean) {
    this.assertSupported();
    if (this.platform === "linux") return this.setSystemdEnabled(enabled);

    await this.refresh();

    if (this.configuredValue && !this.enabled) {
      if (enabled) {
        throw new HostOperationError(
          "autostart_conflict",
          "The Windows DeskCue autostart value is owned by another command. Remove it manually before enabling."
        );
      }

      return this.status;
    }

    if (enabled) {
      try {
        await this.runRegistry([
          "add",
          AUTOSTART_REGISTRY_KEY,
          "/v",
          AUTOSTART_VALUE_NAME,
          "/t",
          "REG_SZ",
          "/d",
          this.expectedCommand,
          "/f"
        ]);
      } catch (error) {
        throw toAutostartError(error);
      }
    } else {
      try {
        await this.runRegistry([
          "delete",
          AUTOSTART_REGISTRY_KEY,
          "/v",
          AUTOSTART_VALUE_NAME,
          "/f"
        ]);
      } catch (error) {
        if (!isMissingRegistryValue(error)) throw toAutostartError(error);
      }
    }

    this.configuredValue = enabled ? { command: this.expectedCommand, type: "REG_SZ" } : null;
    this.enabled = enabled;

    return this.status;
  }

  private assertSupported() {
    if (this.supported) return;

    throw new HostOperationError(
      "autostart_unsupported",
      "DeskCue autostart is available only in supported installed Windows and Linux builds."
    );
  }

  private async refreshSystemd() {
    try {
      const result = await this.runSystemctl(["--user", "is-enabled", LINUX_AUTOSTART_SERVICE]);

      this.enabled = result.stdout.trim() === "enabled";
    } catch (error) {
      if (!isDisabledSystemdUnit(error)) throw toSystemdAutostartError(error);

      this.enabled = false;
    }

    return this.status;
  }

  private async setSystemdEnabled(enabled: boolean) {
    try {
      await this.runSystemctl(["--user", "daemon-reload"]);
      await this.runSystemctl(["--user", enabled ? "enable" : "disable", LINUX_AUTOSTART_SERVICE]);
    } catch (error) {
      throw toSystemdAutostartError(error);
    }

    this.enabled = enabled;

    return this.status;
  }
}
