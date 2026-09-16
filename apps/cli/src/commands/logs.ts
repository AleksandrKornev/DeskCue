import { createReadStream, existsSync } from "node:fs";
import { readBoundedFileTail } from "./doctor/dataInspection.ts";
import { followLogs } from "./logs/follower.ts";
import {
  LogOutputBackpressureError,
  writeFollowReady,
  writeLogLine,
  writeLogOutput,
  writeLogSummary,
  writeOversizedRecordNotice,
  writeRawExportWarning,
  writeTruncationNotice
} from "./logs/presentation.ts";
import { countLogLevels, isOversizedLogRecord, parseLogLine } from "./logs/records.ts";
import { sanitizeTerminalLine } from "../output.ts";
import type { CliIo } from "../output.ts";
import { resolveCliDataPaths } from "../paths.ts";

type LogStreamCounts = { errors: number; records: number; warnings: number };

function writeCountedLogRecord(
  line: string,
  path: string,
  io: CliIo,
  json: boolean,
  counts: LogStreamCounts
) {
  if (!line) return;

  if (isOversizedLogRecord(line)) {
    writeOversizedRecordNotice(io, json, path);
    return;
  }

  const level = parseLogLine(line).level;

  counts.records += 1;
  if (level === "error" || level === "fatal") counts.errors += 1;
  if (level === "warn") counts.warnings += 1;
  writeLogLine(io, line, json, path);
}

async function streamAllLogRecords(path: string, io: CliIo, json: boolean) {
  const counts: LogStreamCounts = { errors: 0, records: 0, warnings: 0 };

  if (!existsSync(path)) return counts;

  const input = createReadStream(path, { encoding: "utf8" });
  let discardUntilNewline = false;
  let pendingText = "";

  try {
    for await (const chunk of input) {
      let text = typeof chunk === "string" ? chunk : chunk.toString("utf8");

      if (discardUntilNewline) {
        const newlineIndex = text.indexOf("\n");

        if (newlineIndex < 0) continue;

        text = text.slice(newlineIndex + 1);
        discardUntilNewline = false;
      }

      const lines = `${pendingText}${text}`.split(/\r?\n/u);

      pendingText = lines.pop() ?? "";
      for (const line of lines) writeCountedLogRecord(line, path, io, json, counts);

      if (isOversizedLogRecord(pendingText)) {
        pendingText = "";
        discardUntilNewline = true;
        writeOversizedRecordNotice(io, json, path);
      }
    }

    if (!discardUntilNewline) writeCountedLogRecord(pendingText, path, io, json, counts);
  } finally {
    input.destroy();
  }

  return counts;
}

async function streamRawLogFile(path: string, io: CliIo) {
  if (!existsSync(path)) return;
  if (!io.stdoutBytes) throw new Error("Raw log export requires a byte-capable output sink.");

  const input = createReadStream(path);

  try {
    for await (const chunk of input) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      const accepted = await io.stdoutBytes(bytes);

      if (accepted === false) throw new LogOutputBackpressureError();
    }
  } finally {
    input.destroy();
  }
}

export function readLogTail(lineLimit: number) {
  const path = resolveCliDataPaths().logFile;
  const tail = existsSync(path)
    ? readBoundedFileTail(path, lineLimit)
    : { endAnchor: "", fileSize: 0, lines: [], pendingText: "", truncated: false };

  return {
    ...tail,
    path
  };
}

export { followLogs } from "./logs/follower.ts";

export async function runLogsCommand({
  all = false,
  follow,
  io,
  json,
  lines,
  raw = false,
  signal
}: {
  all?: boolean;
  follow: boolean;
  io: CliIo;
  json: boolean;
  lines: number;
  raw?: boolean;
  signal: AbortSignal;
}) {
  const path = resolveCliDataPaths().logFile;

  if (raw) {
    writeRawExportWarning(io, path);
    await streamRawLogFile(path, io);
    return;
  }

  if (all) {
    if (!json) {
      writeLogOutput(
        io,
        `DeskCue daemon logs\n  File: ${sanitizeTerminalLine(path)}\n  Scanning bounded, redacted records\n\n`
      );
    }

    const counts = await streamAllLogRecords(path, io, json);

    if (!json) {
      if (counts.records === 0) writeLogOutput(io, `No DeskCue daemon logs found at ${sanitizeTerminalLine(path)}.\n`);
      else writeLogSummary(io, counts.records, counts.records, true, counts);
    }

    return;
  }

  const tail = readLogTail(lines);

  if (json && !follow) {
    writeLogOutput(io, `${JSON.stringify({
      schemaVersion: 1,
      command: "logs",
      data: {
        path: tail.path,
        records: tail.lines.map(parseLogLine),
        truncated: tail.truncated
      },
      message: `Read ${tail.lines.length} DeskCue daemon log record(s).`,
      ok: true,
    })}\n`);
    return;
  }

  if (!json && tail.lines.length > 0) {
    writeLogOutput(
      io,
      `DeskCue daemon logs\n  File: ${sanitizeTerminalLine(tail.path)}\n  Showing latest ${tail.lines.length} record${tail.lines.length === 1 ? "" : "s"}\n\n`
    );
  }

  if (tail.truncated) writeTruncationNotice(io, json, tail.path);

  for (const line of tail.lines) writeLogLine(io, line, json, tail.path, !follow);

  if (!follow) {
    if (!json && tail.lines.length === 0) {
      const message = tail.truncated
        ? `No complete DeskCue log records were available in the bounded tail at ${sanitizeTerminalLine(tail.path)}.`
        : `No DeskCue daemon logs found at ${sanitizeTerminalLine(tail.path)}.`;

      writeLogOutput(io, `${message}\n`);
    }

    if (!json && tail.lines.length > 0) {
      writeLogSummary(io, tail.lines.length, lines, false, countLogLevels(tail.lines));
    }

    return;
  }

  writeFollowReady(io, json, tail.path);

  await followLogs(
    tail.path,
    io,
    json,
    signal,
    undefined,
    tail.pendingText,
    tail.fileSize,
    tail.endAnchor
  );
}
