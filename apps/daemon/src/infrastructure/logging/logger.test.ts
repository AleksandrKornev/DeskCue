import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createAsyncRotatingFileDestination } from "./asyncRotatingFileDestination.ts";
import { readDaemonLogTail } from "./daemonLogReader.ts";
import { logger } from "./logger.ts";
import { runWithRequestContext } from "./requestContext.ts";

test("logger includes request id from async request context", () => {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };

  try {
    runWithRequestContext({ requestId: "request-1" }, () => {
      logger.info("Inside request context", {
        operation: "test"
      });
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(lines.length, 1);
  const payload = JSON.parse(lines[0]) as {
    context?: {
      operation?: string;
      requestId?: string;
    };
  };
  assert.equal(payload.context?.requestId, "request-1");
  assert.equal(payload.context?.operation, "test");
});

test("logger writes redacted JSON lines to configured file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-logger-"));
  const logFile = join(tempDir, "daemon.jsonl");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { closeLogger, logger } from './src/infrastructure/logging/logger.ts';",
          "logger.info('File logging test', { accessToken: 'secret-token', inputPreview: 'private prompt', sessionId: 'session-1' });",
          "await closeLogger();"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKCUE_LOG_FILE: logFile,
          DESKCUE_LOG_TO_FILE: "true",
          DESKCUE_LOG_TO_STDOUT: "false"
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const line = readFileSync(logFile, "utf8").trim();
    const payload = JSON.parse(line) as {
      context?: {
        accessToken?: string;
        inputPreview?: string;
        sessionId?: string;
      };
      message?: string;
    };

    assert.equal(payload.message, "File logging test");
    assert.equal(payload.context?.accessToken, "[redacted]");
    assert.equal(payload.context?.inputPreview, "[redacted]");
    assert.equal(payload.context?.sessionId, "session-1");
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("logger uses DESKCUE_DATA_DIR for the default log file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-logger-data-"));
  const logFile = join(tempDir, "service", "logs", "daemon.jsonl");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { flushLogger, logger } from './src/infrastructure/logging/logger.ts';",
          "logger.info('Data dir logging test');",
          "await flushLogger();"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKCUE_DATA_DIR: tempDir,
          DESKCUE_LOG_FILE: "",
          DESKCUE_LOG_TO_FILE: "true",
          DESKCUE_LOG_TO_STDOUT: "false"
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const line = readFileSync(logFile, "utf8").trim();
    const payload = JSON.parse(line) as {
      message?: string;
    };

    assert.equal(payload.message, "Data dir logging test");
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("daemon log reader returns parsed tail entries from configured file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-logger-"));
  const logFile = join(tempDir, "daemon.jsonl");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { flushLogger, logger } from './src/infrastructure/logging/logger.ts';",
          "import { appendFileSync } from 'node:fs';",
          "import { readDaemonLogTail } from './src/infrastructure/logging/daemonLogReader.ts';",
          "logger.info('First log entry', { sessionId: 'session-1' });",
          "logger.warn('Second log entry', { token: 'secret-token' });",
          "await flushLogger();",
          "appendFileSync(process.env.DESKCUE_LOG_FILE, JSON.stringify({ level: 'info', message: 'Raw path', context: { path: '/ws?token=historical-secret' } }) + '\\n');",
          "const payload = await readDaemonLogTail(1);",
          "console.log(JSON.stringify(payload));"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKCUE_LOG_FILE: logFile,
          DESKCUE_LOG_TO_FILE: "true",
          DESKCUE_LOG_TO_STDOUT: "false"
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout.trim()) as {
      entries?: Array<{
        context?: Record<string, unknown> | null;
        level?: string;
        message?: string;
      }>;
      filePath?: string | null;
      truncated?: boolean;
    };

    assert.equal(payload.filePath, logFile);
    assert.equal(payload.truncated, true);
    assert.equal(payload.entries?.length, 1);
    assert.equal(payload.entries?.[0]?.level, "info");
    assert.equal(payload.entries?.[0]?.message, "Raw path");
    assert.equal(payload.entries?.[0]?.context?.path, "/ws?token=[redacted]");
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("daemon log reader bounds file reads and returns only complete tail lines", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-log-tail-"));
  const logFile = join(tempDir, "daemon.jsonl");

  try {
    await writeFile(logFile, [
      "x".repeat(2 * 1024 * 1024),
      JSON.stringify({ level: "info", message: "one" }),
      JSON.stringify({ level: "warn", message: "two" }),
      ""
    ].join("\n"));

    const result = await readDaemonLogTail(2, logFile);

    assert.equal(result.truncated, true);
    assert.deepEqual(result.entries.map((entry) => entry.message), ["one", "two"]);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("async log destination flushes repeatedly and rotates without sync filesystem writes", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-logger-async-"));
  const logFile = join(tempDir, "daemon.jsonl");
  const errors: string[] = [];
  const destination = createAsyncRotatingFileDestination({
    filePath: logFile,
    maxBatchBytes: 64,
    maxFileSizeBytes: 80,
    maxFiles: 2,
    maxQueueBytes: 1024,
    reportError: (message) => errors.push(message)
  });

  try {
    destination.write(`${"a".repeat(49)}\n`);
    await destination.flush();
    assert.equal(readFileSync(logFile, "utf8"), `${"a".repeat(49)}\n`);

    destination.write(`${"b".repeat(49)}\n`);
    await destination.flush();
    assert.equal(readFileSync(logFile, "utf8"), `${"b".repeat(49)}\n`);
    assert.equal(readFileSync(`${logFile}.1`, "utf8"), `${"a".repeat(49)}\n`);
    assert.deepEqual(errors, []);

    const firstClose = destination.close();
    const secondClose = destination.close();
    assert.equal(firstClose, secondClose);
    await firstClose;
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("async log destination bounds its queue and reports dropped messages", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-logger-bounded-"));
  const logFile = join(tempDir, "daemon.jsonl");
  const errors: string[] = [];
  const destination = createAsyncRotatingFileDestination({
    filePath: logFile,
    maxBatchBytes: 1024,
    maxFileSizeBytes: 1024,
    maxFiles: 1,
    maxQueueBytes: 80,
    reportError: (message) => errors.push(message)
  });

  try {
    assert.equal(destination.write(`${"a".repeat(49)}\n`), true);
    assert.equal(destination.write(`${"b".repeat(49)}\n`), false);
    await destination.flush();
    await Promise.resolve();

    assert.equal(readFileSync(logFile, "utf8"), `${"a".repeat(49)}\n`);
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? "", /dropped 1 log message/);
    assert.match(errors[0] ?? "", /80-byte queue is full/);

    await destination.close();
    assert.equal(destination.write("after close\n"), false);
    await Promise.resolve();
    assert.equal(errors.length, 2);
    assert.match(errors[1] ?? "", /logger is closed/);
    assert.equal(existsSync(`${logFile}.1`), false);
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});
