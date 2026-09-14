import assert from "node:assert/strict";
import test from "node:test";

import { CliUsageError, parseCliArguments } from "./args.ts";

test("parses command-specific options and global JSON output", () => {
  assert.deepEqual(parseCliArguments(["logs", "--json", "--follow", "--lines", "25"]), {
    all: false,
    autostartAction: null,
    channel: null,
    check: false,
    command: "logs",
    follow: true,
    help: false,
    hostAction: null,
    json: true,
    lines: 25,
    print: false,
    timeoutMs: 15_000,
    wait: false
  });
});

test("parses complete log output and rejects conflicting log modes", () => {
  const parsed = parseCliArguments(["logs", "--all", "--json"]);

  assert.equal(parsed.all, true);
  assert.equal(parsed.lines, 8);
  assert.throws(() => parseCliArguments(["logs", "--all", "--follow"]), CliUsageError);
  assert.throws(() => parseCliArguments(["logs", "--all", "--lines", "50"]), CliUsageError);
});

test("parses updater channel and autostart action", () => {
  const update = parseCliArguments(["update", "--check", "--channel", "beta"]);
  const autostart = parseCliArguments(["autostart", "enable", "--json"]);

  assert.equal(update.channel, "beta");
  assert.equal(update.check, true);
  assert.equal(autostart.autostartAction, "enable");
  assert.equal(autostart.json, true);
});

test("accepts JSON output before the command", () => {
  const parsed = parseCliArguments(["--json", "status"]);

  assert.equal(parsed.command, "status");
  assert.equal(parsed.json, true);
});

test("accepts help followed by a command name", () => {
  const parsed = parseCliArguments(["help", "logs", "--json"]);

  assert.equal(parsed.command, "logs");
  assert.equal(parsed.help, true);
  assert.equal(parsed.json, true);
});

test("rejects unknown commands, misplaced flags and incomplete values", () => {
  assert.throws(() => parseCliArguments(["wat"]), CliUsageError);
  assert.throws(() => parseCliArguments(["status", "--force"]), CliUsageError);
  assert.throws(() => parseCliArguments(["logs", "--lines"]), CliUsageError);
  assert.throws(() => parseCliArguments(["autostart"]), CliUsageError);
});

test("rejects numeric options unless the complete token is an integer", () => {
  assert.throws(() => parseCliArguments(["logs", "--lines", "1.5"]), CliUsageError);
  assert.throws(() => parseCliArguments(["logs", "--lines", "25records"]), CliUsageError);
  assert.throws(() => parseCliArguments(["host", "shutdown", "--timeout", "100ms"]), CliUsageError);
});

test("parses the internal installer host shutdown command", () => {
  const parsed = parseCliArguments(["host", "shutdown", "--wait", "--timeout", "5000"]);

  assert.equal(parsed.hostAction, "shutdown");
  assert.equal(parsed.wait, true);
  assert.equal(parsed.timeoutMs, 5000);
});
