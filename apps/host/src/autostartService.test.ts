import assert from "node:assert/strict";
import test from "node:test";

import { HostAutostartService, resolveTrayExecutablePath } from "./autostartService.ts";

test("resolves the installed tray beside the packaged app directory", () => {
  assert.equal(
    resolveTrayExecutablePath({
      env: {},
      hostEntryPath: "C:\\Program Files\\DeskCue\\app\\apps\\host\\dist\\index.js"
    }),
    "C:\\Program Files\\DeskCue\\DeskCue.Tray.exe"
  );
});

test("reads and changes the single current-user DeskCue Run value", async () => {
  const calls: string[][] = [];
  const expectedCommand = '"C:\\DeskCue\\DeskCue.Tray.exe" --autostart';
  let configuredCommand: string | null = expectedCommand;
  const service = new HostAutostartService({
    env: { DESKCUE_DISTRIBUTION_MODE: "installed" },
    platform: "win32",
    runRegistry: async (arguments_) => {
      calls.push(arguments_);
      if (arguments_[0] === "delete") configuredCommand = null;
      if (arguments_[0] === "add") configuredCommand = arguments_.at(-2) ?? null;
      if (arguments_[0] === "query" && !configuredCommand) throw Object.assign(new Error("missing"), { code: 1 });

      return {
        stdout: arguments_[0] === "query"
          ? `    DeskCue    REG_SZ    ${configuredCommand}\r\n`
          : ""
      };
    },
    trayExecutablePath: "C:\\DeskCue\\DeskCue.Tray.exe"
  });

  assert.deepEqual(await service.refresh(), { enabled: true, supported: true });
  assert.deepEqual(await service.setEnabled(false), { enabled: false, supported: true });
  assert.deepEqual(await service.setEnabled(true), { enabled: true, supported: true });
  assert.deepEqual(calls.map((call) => call[0]), ["query", "query", "delete", "query", "add"]);
  assert.deepEqual(calls[4]?.slice(-2), [expectedCommand, "/f"]);
});

test("does not overwrite or delete a conflicting DeskCue Run value", async () => {
  const calls: string[][] = [];
  const service = new HostAutostartService({
    env: { DESKCUE_DISTRIBUTION_MODE: "installed" },
    platform: "win32",
    runRegistry: async (arguments_) => {
      calls.push(arguments_);
      return { stdout: "    DESKCUE    REG_EXPAND_SZ    %LOCALAPPDATA%\\unexpected.exe\r\n" };
    },
    trayExecutablePath: "C:\\DeskCue\\DeskCue.Tray.exe"
  });

  assert.deepEqual(await service.setEnabled(false), { enabled: false, supported: true });
  await assert.rejects(service.setEnabled(true), /owned by another command/u);
  assert.deepEqual(calls.map((call) => call[0]), ["query", "query"]);
});

test("keeps autostart unsupported outside installed Windows builds", () => {
  const service = new HostAutostartService({
    env: {},
    platform: "win32",
    trayExecutablePath: "C:\\missing\\DeskCue.Tray.exe"
  });

  assert.deepEqual(service.status, { enabled: null, supported: false });
});

test("reads and changes installed Linux systemd user autostart", async () => {
  const calls: string[][] = [];
  let enabled = false;
  const service = new HostAutostartService({
    env: { DESKCUE_DISTRIBUTION_MODE: "installed", DESKCUE_HOST_LAUNCH_MODE: "systemd-user" },
    platform: "linux",
    runSystemctl: async (arguments_) => {
      calls.push(arguments_);
      if (arguments_[1] === "is-enabled") {
        if (!enabled) throw Object.assign(new Error("disabled"), { code: 1 });

        return { stdout: "enabled\n" };
      }

      enabled = arguments_[1] === "enable";
      return { stdout: "" };
    }
  });

  assert.deepEqual(await service.refresh(), { enabled: false, supported: true });
  assert.deepEqual(await service.setEnabled(true), { enabled: true, supported: true });
  assert.deepEqual(await service.refresh(), { enabled: true, supported: true });
  assert.deepEqual(await service.setEnabled(false), { enabled: false, supported: true });
  assert.deepEqual(calls, [
    ["--user", "is-enabled", "deskcue-host.service"],
    ["--user", "daemon-reload"],
    ["--user", "enable", "deskcue-host.service"],
    ["--user", "is-enabled", "deskcue-host.service"],
    ["--user", "daemon-reload"],
    ["--user", "disable", "deskcue-host.service"]
  ]);
});
