import { once } from "node:events";
import { stripVTControlCharacters } from "node:util";

export type CliIo = {
  stderr: (text: string) => boolean | void;
  stdout: (text: string) => boolean | void;
  stdoutBytes?: (bytes: Uint8Array) => boolean | Promise<void> | void;
};

export type CliResult<T = unknown> = {
  command: string;
  data?: T;
  message: string;
  ok: boolean;
};

async function writeProcessStdoutBytes(bytes: Uint8Array) {
  if (process.stdout.write(bytes)) return;

  await once(process.stdout, "drain");
}

export const processCliIo: CliIo = {
  stderr: (text) => process.stderr.write(text),
  stdout: (text) => process.stdout.write(text),
  stdoutBytes: writeProcessStdoutBytes
};

export function sanitizeTerminalLine(value: string) {
  let result = "";

  for (const character of stripVTControlCharacters(value)) {
    const codePoint = character.codePointAt(0)!;

    if (character === "\n" || character === "\r" || character === "\t") {
      result += " ";
    } else if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      result += "�";
    } else {
      result += character;
    }
  }

  return result;
}

function sanitizeTerminalOutput(value: string) {
  return value.split("\n").map(sanitizeTerminalLine).join("\n");
}

export function writeCliResult(io: CliIo, result: CliResult, json: boolean) {
  if (json) {
    io.stdout(`${JSON.stringify({
      schemaVersion: 1,
      ...result
    })}\n`);
    return;
  }

  io.stdout(`${sanitizeTerminalOutput(result.message)}\n`);
}

export function writeCliError(
  io: CliIo,
  command: string,
  message: string,
  json: boolean,
  code = "operation_failed",
  details: Record<string, unknown> | null = null,
  retryable = false
) {
  if (json) {
    io.stdout(`${JSON.stringify({
      schemaVersion: 1,
      command,
      error: {
        code,
        ...(details ? { details } : {}),
        message,
        retryable
      },
      ok: false
    })}\n`);
    return;
  }

  io.stderr(`Error: ${sanitizeTerminalLine(message)}\n`);
  const blockers = details?.blockers;

  if (!Array.isArray(blockers)) return;

  for (const blocker of blockers) {
    if (!blocker || typeof blocker !== "object" || Array.isArray(blocker)) continue;

    const value = blocker as Record<string, unknown>;
    const codeLabel = typeof value.code === "string" ? value.code : "blocked";
    const count = typeof value.count === "number" ? `, count: ${value.count}` : "";
    const explanation = typeof value.message === "string" ? value.message : codeLabel;

    io.stderr(`  - ${sanitizeTerminalLine(explanation)} (${sanitizeTerminalLine(codeLabel)}${count})\n`);
  }
}
