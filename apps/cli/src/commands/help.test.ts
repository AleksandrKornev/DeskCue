import assert from "node:assert/strict";
import test from "node:test";

import { formatCommandHelp, formatUsage } from "./help.ts";

test("update help states the installation and restart side effects before action", () => {
  const help = formatCommandHelp("update");

  assert.match(help, /Without --check, DeskCue checks, downloads and verifies the update\./u);
  assert.match(help, /starts installation and restarts/u);
  assert.match(help, /With --check, no update is downloaded or installed\./u);
  assert.match(help, /default channel is stable/u);
});

test("command help explains defaults and important side effects", () => {
  assert.match(formatCommandHelp("logs"), /default: 8/u);
  assert.match(formatCommandHelp("logs"), /--all/u);
  assert.match(formatCommandHelp("logs"), /-f, --follow/u);
  assert.match(formatCommandHelp("open"), /start the Host and daemon/iu);
  assert.match(formatCommandHelp("stop"), /Host remains running; this command does not exit the tray/u);
  assert.match(formatCommandHelp("doctor"), /read-only/u);
  assert.match(formatCommandHelp("autostart"), /installed Windows and Linux builds/u);
  assert.match(formatCommandHelp("host"), /Internal installer coordination command/u);
});

test("general help keeps update discovery compact", () => {
  assert.match(formatUsage(), /update\s+Check for or install an update/u);
});

test("general command summaries do not end with sentence punctuation", () => {
  const commands = formatUsage().split("Commands:\n")[1]!.split("\n\nGlobal options:")[0]!;

  assert.doesNotMatch(commands, /\.\s*$/mu);
});

test("general help documents the stable exit-code contract", () => {
  const help = formatUsage();

  assert.match(help, /0\s+Success/u);
  assert.match(help, /1\s+Operation failed/u);
  assert.match(help, /2\s+Invalid command or option/u);
  assert.match(help, /3\s+Host or daemon is inactive/u);
  assert.match(help, /4\s+Operation refused by a safety or capability check/u);
  assert.match(help, /5\s+Operation timed out/u);
  assert.match(help, /--version, -v/u);
});
