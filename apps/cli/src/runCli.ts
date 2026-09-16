import type { HostStatus } from "@deskcue/host-control";

import { CliUsageError, parseCliArguments } from "./args.ts";
import type { ParsedCliArguments } from "./args.ts";
import { updateAutostart, formatAutostartMessage } from "./commands/autostart.ts";
import { evaluateDoctorHealth, formatDoctorReport, readDoctorReport } from "./commands/doctor.ts";
import type { DoctorHealth } from "./commands/doctor.ts";
import { formatCommandHelp, formatUsage, readCliVersion } from "./commands/help.ts";
import { shutdownHost } from "./commands/host.ts";
import { runLogsCommand } from "./commands/logs.ts";
import { openDeskCue, openExternalUrl } from "./commands/open.ts";
import type { LaunchHost } from "./host/hostLauncher.ts";
import { formatRestartMessage, restartDeskCue } from "./commands/restart.ts";
import { formatStartMessage, startDeskCue } from "./commands/start.ts";
import { formatStatus, readCliStatusSnapshot, readDeskCueStatus } from "./commands/status.ts";
import type { CliStatusSnapshot } from "./commands/status.ts";
import { formatStopMessage, stopDeskCue } from "./commands/stop.ts";
import { formatUpdateError, formatUpdateMessage, updateDeskCue } from "./commands/update.ts";
import { CLI_EXIT_CODES } from "./exitCodes.ts";
import type { CliExitCode } from "./exitCodes.ts";
import {
  createHostRequest,
  HostControlRejectedError,
  isHostTimeoutError
} from "./host/hostClient.ts";
import type { HostRequest } from "./host/hostClient.ts";
import { launchDetachedHost } from "./host/hostLauncher.ts";
import { processCliIo, sanitizeTerminalLine, writeCliError, writeCliResult } from "./output.ts";
import type { CliIo } from "./output.ts";

type CliDependencies = {
  fetch?: typeof fetch;
  io?: CliIo;
  launchHost?: LaunchHost;
  openUrl?: (url: string) => Promise<void>;
  requestHost?: HostRequest;
  signal?: AbortSignal;
};

const REFUSED_HOST_ERROR_CODES = new Set([
  "autostart_conflict",
  "autostart_unsupported",
  "busy",
  "host_shutting_down",
  "not_allowed",
  "operation_in_progress",
  "update_blocked",
  "update_in_progress",
  "update_not_available",
  "update_not_checked",
  "update_not_staged",
  "update_unsupported",
  "update_version_changed"
]);

function lifecycleExitCode(status: HostStatus, expectedState: "running" | "stopped") {
  if (status.daemon.state === expectedState) return CLI_EXIT_CODES.success;

  return status.daemon.state === "degraded" ? CLI_EXIT_CODES.failure : CLI_EXIT_CODES.timeout;
}

function statusExitCode(status: HostStatus | null) {
  if (
    status?.host.state === "degraded" ||
    status?.daemon.state === "degraded" ||
    status?.update.state === "failed"
  ) {
    return CLI_EXIT_CODES.failure;
  }

  if (!status || status.host.state !== "running" || status.daemon.state !== "running") {
    return CLI_EXIT_CODES.inactive;
  }

  return CLI_EXIT_CODES.success;
}

function errorExitCode(error: unknown): CliExitCode {
  if (error instanceof HostControlRejectedError) {
    return REFUSED_HOST_ERROR_CODES.has(error.code)
      ? CLI_EXIT_CODES.refused
      : CLI_EXIT_CODES.failure;
  }

  if (isHostTimeoutError(error)) return CLI_EXIT_CODES.timeout;

  return CLI_EXIT_CODES.failure;
}

function doctorExitCode(health: DoctorHealth): CliExitCode {
  if (health.summary.failed > 0) return CLI_EXIT_CODES.failure;
  if (health.summary.status === "inactive") return CLI_EXIT_CODES.inactive;

  return CLI_EXIT_CODES.success;
}

function readRequestedCommandName(argv: string[]) {
  const values = argv.filter((value) => value !== "--json");
  const command = values[0];

  if (command === "--version" || command === "-v") return "version";

  return command && !command.startsWith("-") ? command : "help";
}

function writeStatusResult(
  io: CliIo,
  command: string,
  message: string,
  status: HostStatus | null,
  json: boolean,
  exitCode: CliExitCode,
  extraData: Record<string, unknown> = {}
) {
  writeCliResult(io, {
    command,
    data: { status, ...extraData },
    message,
    ok: exitCode === CLI_EXIT_CODES.success
  }, json);
}

function formatDoctorRuntimeOverview(status: HostStatus | null, error: string | null) {
  if (error) return `Runtime: Host query failed (${sanitizeTerminalLine(error)})`;
  if (!status) return "Runtime: Host and daemon are inactive";

  const daemonVersion = status.daemon.version
    ? `, version ${sanitizeTerminalLine(status.daemon.version)}`
    : "";
  const autostart = !status.autostart.supported
    ? "unsupported"
    : status.autostart.enabled === null
      ? "unknown"
      : status.autostart.enabled
        ? "enabled"
        : "disabled";

  return [
    "Runtime:",
    `  Host: ${status.host.state}, version ${sanitizeTerminalLine(status.host.version)}`,
    `  Daemon: ${status.daemon.state}${daemonVersion}`,
    `  Update: ${status.update.state}`,
    `  Autostart: ${autostart}`
  ].join("\n");
}

function createDoctorRuntimeData(status: HostStatus | null) {
  if (!status) return null;

  return {
    autostart: status.autostart,
    busyReason: status.busyReason,
    daemon: status.daemon,
    host: status.host,
    update: status.update
  };
}

function formatMachineStatusMessage(status: HostStatus | null) {
  if (!status) return "DeskCue Host and daemon are inactive.";

  const update = status.update.state === "failed" ? " The last update operation failed." : "";

  return `DeskCue daemon is ${status.daemon.state}.${update}`;
}

async function dispatchCommand(
  parsed: ParsedCliArguments,
  {
    fetch,
    io,
    launchHost,
    openUrl,
    requestHost,
    signal
  }: Required<CliDependencies>
): Promise<CliExitCode> {
  if (parsed.help) {
    const help = parsed.command === "help" ? formatUsage() : formatCommandHelp(parsed.command);

    writeCliResult(io, {
      command: parsed.command,
      data: { help },
      message: parsed.json ? `DeskCue ${parsed.command} help.` : help,
      ok: true
    }, parsed.json);
    return CLI_EXIT_CODES.success;
  }

  switch (parsed.command) {
    case "help":
      writeCliResult(io, {
        command: "help",
        data: { help: formatUsage() },
        message: parsed.json ? "DeskCue CLI help." : formatUsage(),
        ok: true
      }, parsed.json);
      return CLI_EXIT_CODES.success;
    case "version": {
      const version = readCliVersion();

      writeCliResult(io, {
        command: "version",
        data: { version },
        message: version,
        ok: true
      }, parsed.json);
      return CLI_EXIT_CODES.success;
    }

    case "host": {
      const status = await shutdownHost({
        request: requestHost,
        timeoutMs: parsed.timeoutMs,
        wait: parsed.wait
      });

      writeStatusResult(
        io,
        "host shutdown",
        status ? "DeskCue Host shutdown requested." : "DeskCue Host is stopped.",
        status,
        parsed.json,
        CLI_EXIT_CODES.success
      );

      return CLI_EXIT_CODES.success;
    }

    case "start": {
      const status = await startDeskCue(requestHost, launchHost);
      const exitCode = lifecycleExitCode(status, "running");

      writeStatusResult(io, "start", formatStartMessage(status), status, parsed.json, exitCode);

      return exitCode;
    }

    case "stop": {
      const status = await stopDeskCue(requestHost);
      const exitCode = status ? lifecycleExitCode(status, "stopped") : CLI_EXIT_CODES.success;

      writeStatusResult(io, "stop", formatStopMessage(status), status, parsed.json, exitCode);

      return exitCode;
    }

    case "restart": {
      const status = await restartDeskCue(requestHost, launchHost);
      const exitCode = lifecycleExitCode(status, "running");

      writeStatusResult(io, "restart", formatRestartMessage(status), status, parsed.json, exitCode);

      return exitCode;
    }

    case "status": {
      const status = await readDeskCueStatus(requestHost);
      const exitCode = statusExitCode(status);
      let snapshot: CliStatusSnapshot | null = null;
      let snapshotUnavailable = false;

      if (status?.daemon.state === "running") {
        try {
          snapshot = await readCliStatusSnapshot(status, fetch);
        } catch {
          snapshotUnavailable = true;
        }
      }

      const message = parsed.json
        ? formatMachineStatusMessage(status)
        : formatStatus(status, snapshot, snapshotUnavailable);

      writeStatusResult(
        io,
        "status",
        message,
        status,
        parsed.json,
        exitCode,
        { overview: snapshot, overviewUnavailable: snapshotUnavailable }
      );

      return exitCode;
    }

    case "open": {
      const result = await openDeskCue({
        launch: launchHost,
        openUrl,
        printOnly: parsed.print,
        request: requestHost
      });

      writeCliResult(io, {
        command: "open",
        data: parsed.json ? { url: result.url } : result,
        message: parsed.print ? result.url : `Opened ${result.url}`,
        ok: true
      }, parsed.json);
      return CLI_EXIT_CODES.success;
    }

    case "logs":
      await runLogsCommand({
        all: parsed.all,
        follow: parsed.follow,
        io,
        json: parsed.json,
        lines: parsed.lines,
        raw: parsed.raw,
        signal
      });
      return CLI_EXIT_CODES.success;
    case "doctor": {
      const report = readDoctorReport();
      const cliVersion = readCliVersion();
      let hostError: string | null = null;
      let hostStatus: HostStatus | null = null;

      try {
        hostStatus = await readDeskCueStatus(requestHost);
      } catch (error) {
        hostError = error instanceof Error ? error.message : String(error);
      }

      const health = evaluateDoctorHealth({ cliVersion, hostError, hostStatus, report });
      const exitCode = doctorExitCode(health);
      const formattedReport = formatDoctorReport(report, health, cliVersion);
      const runtimeOverview = formatDoctorRuntimeOverview(hostStatus, hostError);

      writeCliResult(io, {
        command: "doctor",
        data: {
          ...report,
          cliVersion,
          health,
          hostError,
          runtime: createDoctorRuntimeData(hostStatus)
        },
        message: parsed.json
          ? `DeskCue doctor: ${health.summary.status}.`
          : `${formattedReport}\n\n${runtimeOverview}`,
        ok: exitCode === CLI_EXIT_CODES.success
      }, parsed.json);
      return exitCode;
    }

    case "update": {
      const status = await updateDeskCue({
        channel: parsed.channel,
        check: parsed.check,
        launch: launchHost,
        request: requestHost
      });
      const exitCode = status.update.state === "failed"
        ? CLI_EXIT_CODES.failure
        : CLI_EXIT_CODES.success;

      if (parsed.json) {
        writeCliResult(io, {
          command: "update",
          data: { update: status.update },
          message: formatUpdateMessage(status, parsed.check),
          ok: exitCode === CLI_EXIT_CODES.success
        }, true);
      } else {
        writeStatusResult(io, "update", formatUpdateMessage(status, parsed.check), status, false, exitCode);
      }

      return exitCode;
    }

    case "autostart": {
      const status = await updateAutostart(requestHost, parsed.autostartAction!, launchHost);
      const exitCode = status.autostart.supported
        ? CLI_EXIT_CODES.success
        : CLI_EXIT_CODES.refused;

      if (parsed.json) {
        writeCliResult(io, {
          command: "autostart",
          data: { autostart: status.autostart },
          message: formatAutostartMessage(status),
          ok: exitCode === CLI_EXIT_CODES.success
        }, true);
      } else {
        writeStatusResult(io, "autostart", formatAutostartMessage(status), status, false, exitCode);
      }

      return exitCode;
    }
  }
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}) {
  const io = dependencies.io ?? processCliIo;
  let parsed: ParsedCliArguments;
  try {
    parsed = parseCliArguments(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    writeCliError(io, readRequestedCommandName(argv), message, argv.includes("--json"), "usage");

    if (error instanceof CliUsageError && !argv.includes("--json")) {
      io.stderr("Run deskcue help for usage.\n");
    }

    return CLI_EXIT_CODES.usage;
  }

  const abortController = new AbortController();
  const signal = dependencies.signal ?? abortController.signal;

  try {
    return await dispatchCommand(parsed, {
      fetch: dependencies.fetch ?? fetch,
      io,
      launchHost: dependencies.launchHost ?? launchDetachedHost,
      openUrl: dependencies.openUrl ?? openExternalUrl,
      requestHost: dependencies.requestHost ?? createHostRequest(),
      signal
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = parsed.command === "update" ? formatUpdateError(rawMessage) : rawMessage;
    const exitCode = errorExitCode(error);
    const errorCode = error instanceof HostControlRejectedError
      ? error.code
      : exitCode === CLI_EXIT_CODES.timeout
        ? "timeout"
        : "operation_failed";

    const details = error instanceof HostControlRejectedError ? error.details : null;
    const retryable = error instanceof HostControlRejectedError ? error.retryable : false;

    writeCliError(io, parsed.command, message, parsed.json, errorCode, details, retryable);

    return exitCode;
  }
}
