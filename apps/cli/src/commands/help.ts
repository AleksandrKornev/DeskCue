import { readFileSync } from "node:fs";

import type { CliCommand } from "../args.ts";

const CLI_PACKAGE_URL = new URL("../../package.json", import.meta.url);

type CommandHelp = {
  listSummary?: string;
  notes?: string[];
  options?: string[];
  summary: string;
  usage: string;
};

const commandHelp: Record<CliCommand, CommandHelp> = {
  autostart: {
    listSummary: "Read or change DeskCue startup at sign-in.",
    notes: [
      "Available in installed Windows and Linux builds.",
      "Windows starts the tray; Linux enables the systemd user Host service.",
      "The Host may restore the requested daemon state."
    ],
    options: ["  --json  Emit machine-readable output"],
    summary: "Read or change whether DeskCue starts at sign-in.",
    usage: "deskcue autostart <enable|disable|status> [--json]"
  },
  doctor: {
    listSummary: "Run read-only installation and health checks.",
    notes: [
      "This command is read-only.",
      "Checks include migration recovery and the current update state.",
      "Exit 1 means issues were found; exit 3 means DeskCue is inactive."
    ],
    options: ["  --json  Emit structured checks and a health summary"],
    summary: "Check installation, versions, local data, updates and runtime health.",
    usage: "deskcue doctor [--json]"
  },
  help: {
    listSummary: "Show general or command-specific help.",
    summary: "Show general help or detailed help for one command.",
    usage: "deskcue help [command]"
  },
  host: {
    notes: [
      "Internal installer coordination command.",
      "Normally use deskcue stop or exit the tray.",
      "Without --wait, success means shutdown was requested.",
      "With --wait, success means the Host endpoint stopped."
    ],
    options: [
      "  --wait                   Wait until the Host endpoint stops",
      "  --timeout <100-60000>    Total wait deadline in milliseconds; default: 15000",
      "  --json                   Emit machine-readable output"
    ],
    summary: "Request shutdown of the DeskCue Host.",
    usage: "deskcue host shutdown [--wait] [--timeout <100-60000>] [--json]"
  },
  logs: {
    listSummary: "Read or follow daemon logs.",
    notes: [
      "The default view shows a compact form of the latest 8 records.",
      "Use --lines for a larger bounded tail or --all for the complete current log.",
      "Follow mode prints the initial 8-record tail before waiting.",
      "With --follow or --all and --json, output is NDJSON.",
      "Each event frame is written on its own line.",
      "Export every current record:",
      "  deskcue logs --all --json > deskcue-logs.ndjson"
    ],
    options: [
      "  -n, --lines <1-10000>",
      "      Existing records to print; default: 8",
      "  --all",
      "      Print every current record; cannot be combined with --follow",
      "  -f, --follow",
      "      Continue until interrupted with Ctrl+C",
      "  --json",
      "      Emit JSON; follow and --all modes emit NDJSON"
    ],
    summary: "Read recent daemon logs or continue following new records.",
    usage: "deskcue logs [--lines <1-10000> | --all | --follow] [--json]"
  },
  open: {
    listSummary: "Open the local dashboard.",
    notes: ["Both forms start the Host and daemon when needed."],
    options: [
      "  --print  Print the dashboard URL without opening a browser",
      "  --json   Emit machine-readable output"
    ],
    summary: "Open the local DeskCue dashboard.",
    usage: "deskcue open [--print] [--json]"
  },
  restart: {
    listSummary: "Restart the daemon through the Host.",
    notes: [
      "The Host remains running.",
      "Daemon-owned Generic CLI and local-model work may not survive a restart."
    ],
    options: ["  --json  Emit machine-readable output"],
    summary: "Gracefully restart the daemon through the Host.",
    usage: "deskcue restart [--json]"
  },
  start: {
    notes: ["This command is idempotent and starts the Host first when needed."],
    options: ["  --json  Emit machine-readable output"],
    summary: "Start the DeskCue Host and daemon.",
    usage: "deskcue start [--json]"
  },
  status: {
    listSummary: "Show health, activity, agents and runtimes.",
    notes: [
      "Exit 3 means the Host or daemon is inactive.",
      "Exit 1 means the runtime is degraded or the last update operation failed."
    ],
    options: ["  --json  Emit the complete Host status snapshot"],
    summary: "Show Host health, chat activity, available agents, local runtimes, updates and autostart.",
    usage: "deskcue status [--json]"
  },
  stop: {
    notes: [
      "The Host remains running; this command does not exit the tray.",
      "Daemon-owned Generic CLI and local-model work may stop."
    ],
    options: ["  --json  Emit machine-readable output"],
    summary: "Gracefully stop the daemon.",
    usage: "deskcue stop [--json]"
  },
  update: {
    listSummary: "Check for or install an update.",
    notes: [
      "The default channel is stable; --channel applies only to this invocation.",
      "Without --check, DeskCue checks, downloads and verifies the update.",
      "It then starts installation and restarts.",
      "Active local work can block installation.",
      "With --check, no update is downloaded or installed."
    ],
    options: [
      "  --check                    Only check for an available update",
      "  --channel <stable|beta>    Select the feed for this invocation",
      "  --json                     Emit machine-readable output"
    ],
    summary: "Check for an update or explicitly install one.",
    usage: "deskcue update [--check] [--channel <stable|beta>] [--json]"
  },
  version: {
    options: ["  --json  Emit machine-readable output"],
    summary: "Print the DeskCue CLI version.",
    usage: "deskcue version [--json]"
  }
};

const USER_COMMANDS: CliCommand[] = [
  "start",
  "stop",
  "restart",
  "status",
  "open",
  "logs",
  "doctor",
  "update",
  "autostart",
  "version",
  "help"
];

export function readCliVersion() {
  const manifest = JSON.parse(readFileSync(CLI_PACKAGE_URL, "utf8")) as { version?: unknown };

  if (typeof manifest.version !== "string") throw new Error("DeskCue CLI version is invalid.");

  return manifest.version;
}

export function formatCommandHelp(command: CliCommand) {
  const help = commandHelp[command];
  const lines = [help.usage, "", help.summary];

  if (help.options?.length) lines.push("", "Options:", ...help.options);
  if (help.notes?.length) lines.push("", ...help.notes);

  lines.push("", "Run deskcue help to list user commands.");

  return lines.join("\n");
}

export function formatUsage() {
  return [
    "DeskCue CLI",
    "",
    "Usage:",
    "  deskcue <command> [options]",
    "",
    "Commands:",
    ...USER_COMMANDS.map((command) => {
      const help = commandHelp[command];

      return `  ${command.padEnd(11)} ${(help.listSummary ?? help.summary).replace(/\.$/u, "")}`;
    }),
    "",
    "Global options:",
    "  --json         Emit stable machine-readable output",
    "  --help, -h     Show command help",
    "  --version, -v  Print the CLI version",
    "",
    "Streaming output:",
    "  logs --follow --json emits newline-delimited JSON (NDJSON), one frame per line",
    "",
    "Exit codes:",
    "  0  Success",
    "  1  Operation failed or health issues were found",
    "  2  Invalid command or option",
    "  3  Host or daemon is inactive",
    "  4  Operation refused by a safety or capability check",
    "  5  Operation timed out"
  ].join("\n");
}
