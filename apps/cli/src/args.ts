export type CliCommand =
  | "autostart"
  | "doctor"
  | "help"
  | "host"
  | "logs"
  | "open"
  | "restart"
  | "start"
  | "status"
  | "stop"
  | "update"
  | "version";

export type UpdateChannel = "beta" | "stable";
export type AutostartAction = "disable" | "enable" | "status";

export type ParsedCliArguments = {
  all: boolean;
  autostartAction: AutostartAction | null;
  channel: UpdateChannel | null;
  check: boolean;
  command: CliCommand;
  follow: boolean;
  help: boolean;
  hostAction: "shutdown" | null;
  json: boolean;
  lines: number;
  print: boolean;
  raw: boolean;
  timeoutMs: number;
  wait: boolean;
};

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const COMMANDS = new Set<CliCommand>([
  "autostart",
  "doctor",
  "help",
  "host",
  "logs",
  "open",
  "restart",
  "start",
  "status",
  "stop",
  "update",
  "version"
]);
const AUTOSTART_ACTIONS = new Set<AutostartAction>(["disable", "enable", "status"]);
const UPDATE_CHANNELS = new Set<UpdateChannel>(["beta", "stable"]);
const DEFAULT_LOG_LINES = 8;
const MAX_LOG_LINES = 10_000;
const DEFAULT_HOST_TIMEOUT_MS = 15_000;

function isCliCommand(value: string): value is CliCommand {
  return COMMANDS.has(value as CliCommand);
}

function readLogLineCount(value: string | undefined) {
  const parsed = value && /^\d+$/u.test(value) ? Number(value) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LOG_LINES) {
    throw new CliUsageError(`--lines must be an integer between 1 and ${MAX_LOG_LINES}.`);
  }

  return parsed;
}

function readUpdateChannel(value: string | undefined): UpdateChannel {
  if (!value || !UPDATE_CHANNELS.has(value as UpdateChannel)) {
    throw new CliUsageError("--channel must be stable or beta.");
  }

  return value as UpdateChannel;
}

function readTimeout(value: string | undefined) {
  const parsed = value && /^\d+$/u.test(value) ? Number(value) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 60_000) {
    throw new CliUsageError("--timeout must be an integer between 100 and 60000 milliseconds.");
  }

  return parsed;
}

function assertFlagAllowed(command: CliCommand, flag: string, allowedCommands: CliCommand[]) {
  if (!allowedCommands.includes(command)) {
    throw new CliUsageError(`${flag} is not valid for deskcue ${command}.`);
  }
}

export function parseCliArguments(argv: string[]): ParsedCliArguments {
  const json = argv.includes("--json");
  const logLinesSpecified = argv.includes("--lines") || argv.includes("-n");
  const values = argv.filter((value) => value !== "--json");
  const versionRequested = values[0] === "--version" || values[0] === "-v";

  if (versionRequested) values.shift();
  const commandValue = versionRequested
    ? "version"
    : values[0] && !values[0].startsWith("-")
      ? values.shift()!
      : "help";
  if (!isCliCommand(commandValue)) {
    throw new CliUsageError(`Unknown command: ${commandValue}`);
  }

  const parsed: ParsedCliArguments = {
    all: false,
    autostartAction: null,
    channel: null,
    check: false,
    command: commandValue,
    follow: false,
    help: false,
    hostAction: null,
    json,
    lines: DEFAULT_LOG_LINES,
    print: false,
    raw: false,
    timeoutMs: DEFAULT_HOST_TIMEOUT_MS,
    wait: false
  };

  if (parsed.command === "help" && values[0] && !values[0].startsWith("-")) {
    const target = values.shift()!;

    if (!isCliCommand(target)) throw new CliUsageError(`Unknown command: ${target}`);

    parsed.command = target;
    parsed.help = true;
  }

  if (parsed.command === "autostart" && values[0] && !values[0].startsWith("-")) {
    const action = values.shift()!;

    if (!AUTOSTART_ACTIONS.has(action as AutostartAction)) {
      throw new CliUsageError(`Unknown autostart action: ${action}`);
    }

    parsed.autostartAction = action as AutostartAction;
  }

  if (parsed.command === "host" && values[0] && !values[0].startsWith("-")) {
    const action = values.shift()!;

    if (action !== "shutdown") throw new CliUsageError(`Unknown host action: ${action}`);

    parsed.hostAction = action;
  }

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;

    switch (value) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--print":
        assertFlagAllowed(parsed.command, value, ["open"]);
        parsed.print = true;
        break;
      case "--follow":
      case "-f":
        assertFlagAllowed(parsed.command, value, ["logs"]);
        parsed.follow = true;
        break;
      case "--all":
        assertFlagAllowed(parsed.command, value, ["logs"]);
        parsed.all = true;
        break;
      case "--raw":
        assertFlagAllowed(parsed.command, value, ["logs"]);
        parsed.raw = true;
        break;
      case "--check":
        assertFlagAllowed(parsed.command, value, ["update"]);
        parsed.check = true;
        break;
      case "--wait":
        assertFlagAllowed(parsed.command, value, ["host"]);
        parsed.wait = true;
        break;
      case "--lines":
      case "-n":
        assertFlagAllowed(parsed.command, value, ["logs"]);
        parsed.lines = readLogLineCount(values[index + 1]);
        index += 1;
        break;
      case "--channel":
        assertFlagAllowed(parsed.command, value, ["update"]);
        parsed.channel = readUpdateChannel(values[index + 1]);
        index += 1;
        break;
      case "--timeout":
        assertFlagAllowed(parsed.command, value, ["host"]);
        parsed.timeoutMs = readTimeout(values[index + 1]);
        index += 1;
        break;
      default:
        throw new CliUsageError(`Unknown option for deskcue ${parsed.command}: ${value}`);
    }
  }

  if (parsed.command === "autostart" && !parsed.autostartAction && !parsed.help) {
    throw new CliUsageError("deskcue autostart requires enable, disable, or status.");
  }

  if (parsed.command === "host" && !parsed.hostAction && !parsed.help) {
    throw new CliUsageError("deskcue host requires shutdown.");
  }

  if (parsed.command === "logs" && parsed.all && parsed.follow) {
    throw new CliUsageError("--all cannot be combined with --follow; use one output mode at a time.");
  }

  if (parsed.command === "logs" && parsed.all && logLinesSpecified) {
    throw new CliUsageError("--all cannot be combined with --lines.");
  }

  if (parsed.command === "logs" && parsed.raw && !parsed.all) {
    throw new CliUsageError("--raw requires --all because it exports the complete current log file.");
  }

  if (parsed.command === "logs" && parsed.raw && parsed.json) {
    throw new CliUsageError("--raw cannot be combined with --json; raw selects exact byte output.");
  }

  return parsed;
}
