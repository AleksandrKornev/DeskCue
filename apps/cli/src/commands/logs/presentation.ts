import { sanitizeTerminalLine } from "../../output.ts";
import type { CliIo } from "../../output.ts";
import { countLogLevels, formatLogRecord, parseLogLine, redactLogText } from "./records.ts";

export class LogOutputBackpressureError extends Error {
  constructor() {
    super("DeskCue log output stopped because the output consumer could not keep up.");
    this.name = "LogOutputBackpressureError";
  }
}

export function writeLogOutput(io: CliIo, text: string) {
  if (io.stdout(text) === false) throw new LogOutputBackpressureError();
}

export function writeLogSummary(
  io: CliIo,
  shown: number,
  lines: number,
  all: boolean,
  counts: ReturnType<typeof countLogLevels>
) {
  writeLogOutput(
    io,
    `\n${all ? "Records" : "Shown in this view"}: ${shown}  |  Errors: ${counts.errors}  |  Warnings: ${counts.warnings}\n`
  );

  if (all) return;

  writeLogOutput(io, [
    "Next:",
    `  More recent: deskcue logs --lines ${Math.min(lines * 5, 10_000)}`,
    "  Redacted export: deskcue logs --all --json > deskcue-logs.ndjson",
    "  Complete raw export: deskcue logs --all --raw > deskcue-daemon.jsonl",
    "  Live: deskcue logs --follow",
    ""
  ].join("\n"));
}

export function writeLogLine(io: CliIo, line: string, json: boolean, path: string, compact = false) {
  const record = parseLogLine(line);

  writeLogOutput(io, `${json
    ? JSON.stringify({ command: "logs", ok: true, path, record, schemaVersion: 1 })
    : formatLogRecord(record, compact)}\n`);
}

export function writeFollowReady(io: CliIo, json: boolean, path: string) {
  if (json) {
    writeLogOutput(io, `${JSON.stringify({
      command: "logs",
      ok: true,
      path,
      record: null,
      schemaVersion: 1,
      state: "following"
    })}\n`);
    return;
  }

  writeLogOutput(io, `Following DeskCue daemon logs at ${sanitizeTerminalLine(path)}; waiting for new records.\n`);
}

export function writeTruncationNotice(io: CliIo, json: boolean, path: string, skippedBytes?: number) {
  if (json) {
    writeLogOutput(io, `${JSON.stringify({
      command: "logs",
      ok: true,
      path,
      record: null,
      schemaVersion: 1,
      ...(skippedBytes === undefined ? {} : { skippedBytes }),
      state: "truncated"
    })}\n`);
    return;
  }

  const detail = skippedBytes === undefined
    ? "the bounded 1 MiB tail could not contain every requested record"
    : `${skippedBytes} bytes arrived between log polls`;

  writeLogOutput(io, `Warning: ${detail}; partial data was omitted.\n`);
}

export function writeOversizedRecordNotice(io: CliIo, json: boolean, path: string) {
  if (json) {
    writeLogOutput(io, `${JSON.stringify({
      command: "logs",
      ok: true,
      path,
      record: null,
      schemaVersion: 1,
      state: "oversized_record"
    })}\n`);
    return;
  }

  writeLogOutput(io, "Warning: a log record exceeded 1 MiB and was omitted.\n");
}

export function writeRawExportWarning(io: CliIo, path: string) {
  io.stderr(
    `Warning: exporting the complete unredacted DeskCue daemon log from ${sanitizeTerminalLine(path)}; ` +
    "the output may contain secrets or private data.\n"
  );
}

export function writeFollowReadError(io: CliIo, json: boolean, path: string, error: unknown) {
  const message = redactLogText(error instanceof Error ? error.message : String(error));

  if (json) {
    writeLogOutput(io, `${JSON.stringify({
      command: "logs",
      error: { code: "log_read_failed", message, retryable: true },
      ok: false,
      path,
      record: null,
      schemaVersion: 1,
      state: "read_error"
    })}\n`);
    return;
  }

  if (io.stderr(`DeskCue log follow failed and will retry: ${sanitizeTerminalLine(message)}\n`) === false) {
    throw new LogOutputBackpressureError();
  }
}

export function writeFollowRecovered(io: CliIo, json: boolean, path: string) {
  if (json) {
    writeLogOutput(io, `${JSON.stringify({
      command: "logs",
      ok: true,
      path,
      record: null,
      schemaVersion: 1,
      state: "recovered"
    })}\n`);
    return;
  }

  writeLogOutput(io, "DeskCue log follow recovered.\n");
}
