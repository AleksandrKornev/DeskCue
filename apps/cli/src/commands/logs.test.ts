import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { followLogs, readLogTail, runLogsCommand } from "./logs.ts";

function delay(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

test("reads a bounded tail and formats daemon JSON records", async () => {
  const directory = join(tmpdir(), `deskcue-cli-logs-${process.pid}-${Date.now()}`);
  const previousDataDir = process.env.DESKCUE_DATA_DIR;

  try {
    process.env.DESKCUE_DATA_DIR = directory;
    const logDirectory = join(directory, "service", "logs");

    await mkdir(logDirectory, { recursive: true });

    await writeFile(join(logDirectory, "daemon.jsonl"), [
      JSON.stringify({ level: "info", message: "old", timestamp: "2026-09-13T00:00:00.000Z" }),
      JSON.stringify({
        context: { operationId: "update-1" },
        level: "warn",
        message: "new",
        timestamp: "2026-09-13T00:00:01.000Z"
      })
    ].join("\n"));

    assert.equal(readLogTail(1).lines.length, 1);
    let output = "";

    await runLogsCommand({
      follow: false,
      io: {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      json: false,
      lines: 1,
      signal: new AbortController().signal
    });

    assert.match(output, /WARN new/u);
    assert.match(output, /"operationId":"update-1"/u);
    assert.match(output, /DeskCue daemon logs\n  File: .*daemon\.jsonl/u);
    assert.match(output, /Shown in this view: 1\s+\|\s+Errors: 0\s+\|\s+Warnings: 1/u);
    assert.match(output, /Full export: deskcue logs --all --json > deskcue-logs\.ndjson/u);
    assert.doesNotMatch(output, /INFO old/u);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    await rm(directory, { force: true, recursive: true });
  }
});

test("all mode streams the complete current log instead of applying the tail limit", async () => {
  const directory = join(tmpdir(), `deskcue-cli-all-logs-${process.pid}-${Date.now()}`);
  const previousDataDir = process.env.DESKCUE_DATA_DIR;

  try {
    process.env.DESKCUE_DATA_DIR = directory;
    const logDirectory = join(directory, "service", "logs");

    await mkdir(logDirectory, { recursive: true });
    await writeFile(join(logDirectory, "daemon.jsonl"), [
      JSON.stringify({ level: "info", message: "first" }),
      JSON.stringify({ level: "error", message: "last" })
    ].join("\n"));
    let output = "";

    await runLogsCommand({
      all: true,
      follow: false,
      io: {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      json: false,
      lines: 1,
      signal: new AbortController().signal
    });

    assert.match(output, /INFO first/u);
    assert.match(output, /ERROR last/u);
    assert.match(output, /Showing all current records/u);
    assert.match(output, /Records: 2\s+\|\s+Errors: 1/u);
    assert.doesNotMatch(output, /More recent: deskcue logs/u);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    await rm(directory, { force: true, recursive: true });
  }
});

test("default human view keeps long records to one compact terminal line", async () => {
  const directory = join(tmpdir(), `deskcue-cli-compact-logs-${process.pid}-${Date.now()}`);
  const previousDataDir = process.env.DESKCUE_DATA_DIR;

  try {
    process.env.DESKCUE_DATA_DIR = directory;
    const logDirectory = join(directory, "service", "logs");

    await mkdir(logDirectory, { recursive: true });
    await writeFile(join(logDirectory, "daemon.jsonl"), JSON.stringify({
      context: { path: `/api/${"long/".repeat(20)}` },
      level: "info",
      message: "HTTP request completed",
      timestamp: "2026-09-13T00:00:00.000Z"
    }));
    let output = "";

    await runLogsCommand({
      follow: false,
      io: {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      json: false,
      lines: 1,
      signal: new AbortController().signal
    });

    const recordLine = output.split("\n").find((line) => line.includes("INFO"));

    assert.equal(recordLine?.length, 78);
    assert.match(recordLine ?? "", /…$/u);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    await rm(directory, { force: true, recursive: true });
  }
});

test("missing log file returns an empty successful JSON report", async () => {
  const previousDataDir = process.env.DESKCUE_DATA_DIR;

  try {
    process.env.DESKCUE_DATA_DIR = join(tmpdir(), `deskcue-cli-no-logs-${Date.now()}`);
    let output = "";

    await runLogsCommand({
      follow: false,
      io: {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      json: true,
      lines: 10,
      signal: new AbortController().signal
    });

    assert.deepEqual(JSON.parse(output).data.records, []);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
  }
});

test("missing log file explains the empty human result", async () => {
  const previousDataDir = process.env.DESKCUE_DATA_DIR;

  try {
    process.env.DESKCUE_DATA_DIR = join(tmpdir(), `deskcue-cli-no-human-logs-${Date.now()}`);
    let output = "";

    await runLogsCommand({
      follow: false,
      io: {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      json: false,
      lines: 10,
      signal: new AbortController().signal
    });

    assert.match(output, /No DeskCue daemon logs found at/u);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
  }
});

test("bounded tail marks truncation and omits a partial first record", async () => {
  const directory = join(tmpdir(), `deskcue-cli-truncated-tail-${process.pid}-${Date.now()}`);
  const previousDataDir = process.env.DESKCUE_DATA_DIR;

  try {
    process.env.DESKCUE_DATA_DIR = directory;
    const logDirectory = join(directory, "service", "logs");

    await mkdir(logDirectory, { recursive: true });
    await writeFile(
      join(logDirectory, "daemon.jsonl"),
      `${"x".repeat(1024 * 1024 + 128)}\n${JSON.stringify({ level: "info", message: "complete" })}\n`,
      "utf8"
    );

    let output = "";

    await runLogsCommand({
      follow: false,
      io: {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      json: true,
      lines: 10_000,
      signal: new AbortController().signal
    });
    const result = JSON.parse(output);

    assert.equal(result.data.truncated, true);
    assert.deepEqual(result.data.records, [{ level: "info", message: "complete" }]);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    await rm(directory, { force: true, recursive: true });
  }
});

test("human logs neutralize terminal control sequences and embedded newlines", async () => {
  const directory = join(tmpdir(), `deskcue-cli-safe-logs-${process.pid}-${Date.now()}`);
  const previousDataDir = process.env.DESKCUE_DATA_DIR;

  try {
    process.env.DESKCUE_DATA_DIR = directory;
    const logDirectory = join(directory, "service", "logs");

    await mkdir(logDirectory, { recursive: true });
    await writeFile(
      join(logDirectory, "daemon.jsonl"),
      `${JSON.stringify({ level: "warn", message: "safe\u001b]0;spoofed\u0007\nnext" })}\n`,
      "utf8"
    );

    let output = "";

    await runLogsCommand({
      follow: false,
      io: {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      json: false,
      lines: 1,
      signal: new AbortController().signal
    });

    assert.doesNotMatch(output, /\u001b|\u0007/u);
    assert.match(output, /WARN safe next/u);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    await rm(directory, { force: true, recursive: true });
  }
});

test("logs redact sensitive fields and malformed historical records", async () => {
  const directory = join(tmpdir(), `deskcue-cli-redacted-logs-${process.pid}-${Date.now()}`);
  const previousDataDir = process.env.DESKCUE_DATA_DIR;

  try {
    process.env.DESKCUE_DATA_DIR = directory;
    const logDirectory = join(directory, "service", "logs");

    await mkdir(logDirectory, { recursive: true });
    await writeFile(join(logDirectory, "daemon.jsonl"), [
      JSON.stringify({
        context: {
          deviceToken: "device-secret",
          nested: { clientSecret: "client-secret" },
          url: "/ws?token=query-secret"
        },
        level: "info",
        message: "safe"
      }),
      "{\"refreshToken\":\"broken-secret",
      "Authorization: Bearer DEMO-CREDENTIAL with trailing text",
      "password: two words"
    ].join("\n"));
    let output = "";

    await runLogsCommand({
      all: true,
      follow: false,
      io: {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      json: true,
      lines: 1,
      signal: new AbortController().signal
    });

    assert.doesNotMatch(
      output,
      /device-secret|client-secret|query-secret|broken-secret|DEMO-CREDENTIAL|trailing text|two words/u
    );

    assert.match(output, /\[redacted\]/u);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    await rm(directory, { force: true, recursive: true });
  }
});

test("all mode omits an oversized record without buffering or echoing it", async () => {
  const directory = join(tmpdir(), `deskcue-cli-oversized-logs-${process.pid}-${Date.now()}`);
  const previousDataDir = process.env.DESKCUE_DATA_DIR;

  try {
    process.env.DESKCUE_DATA_DIR = directory;
    const logDirectory = join(directory, "service", "logs");

    await mkdir(logDirectory, { recursive: true });
    await writeFile(join(logDirectory, "daemon.jsonl"), [
      JSON.stringify({ message: "x".repeat(1024 * 1024 + 128), token: "oversized-secret" }),
      JSON.stringify({ level: "info", message: "safe-after-oversized" })
    ].join("\n"));
    let output = "";

    await runLogsCommand({
      all: true,
      follow: false,
      io: {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      json: true,
      lines: 1,
      signal: new AbortController().signal
    });

    assert.match(output, /"state":"oversized_record"/u);
    assert.match(output, /safe-after-oversized/u);
    assert.doesNotMatch(output, /oversized-secret/u);
    assert.ok(output.length < 10_000);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    await rm(directory, { force: true, recursive: true });
  }
});

test("follow emits appended complete records and stops on abort", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-${process.pid}-${Date.now()}`);
  const logFile = join(directory, "daemon.jsonl");

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(logFile, "", "utf8");
    const controller = new AbortController();
    let output = "";
    const following = followLogs(logFile, {
      stderr() {},
      stdout(text) {
        output += text;
      }
    }, false, controller.signal);

    await appendFile(logFile, `${JSON.stringify({ level: "info", message: "followed" })}\n`, "utf8");
    await delay(650);
    controller.abort();
    await following;

    assert.match(output, /INFO followed/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("follow bounds a partial record that grows across multiple polls", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-growing-${process.pid}-${Date.now()}`);
  const logFile = join(directory, "daemon.jsonl");

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(logFile, "", "utf8");
    const controller = new AbortController();
    let output = "";
    const following = followLogs(logFile, {
      stderr() {},
      stdout(text) {
        output += text;
      }
    }, false, controller.signal);

    await appendFile(logFile, "x".repeat(600_000), "utf8");
    await delay(650);
    await appendFile(logFile, "y".repeat(600_000), "utf8");
    await delay(650);
    await appendFile(logFile, `\n${JSON.stringify({ level: "info", message: "safe-after-partial" })}\n`, "utf8");
    await delay(650);
    controller.abort();
    await following;

    assert.match(output, /exceeded 1 MiB and was omitted/u);
    assert.match(output, /INFO safe-after-partial/u);
    assert.ok(output.length < 10_000);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("follow marks skipped bursts and discards their partial first record", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-truncated-${process.pid}-${Date.now()}`);
  const logFile = join(directory, "daemon.jsonl");

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(logFile, "", "utf8");
    const controller = new AbortController();
    let output = "";
    const following = followLogs(logFile, {
      stderr() {},
      stdout(text) {
        output += text;
      }
    }, false, controller.signal);

    await appendFile(
      logFile,
      `${"x".repeat(1024 * 1024 + 128)}\n${JSON.stringify({ level: "info", message: "complete" })}\n`,
      "utf8"
    );

    await delay(650);
    controller.abort();
    await following;

    assert.match(output, /Warning: \d+ bytes arrived between log polls/u);
    assert.match(output, /INFO complete/u);
    assert.doesNotMatch(output, /x{100}/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("follow keeps discarding a skipped partial record across polling intervals", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-partial-${process.pid}-${Date.now()}`);
  const logFile = join(directory, "daemon.jsonl");

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(logFile, "", "utf8");
    const controller = new AbortController();
    let output = "";
    const following = followLogs(logFile, {
      stderr() {},
      stdout(text) {
        output += text;
      }
    }, false, controller.signal);

    await appendFile(logFile, "x".repeat(1024 * 1024 + 128), "utf8");
    await delay(650);
    await appendFile(
      logFile,
      `discarded-suffix\n${JSON.stringify({ level: "info", message: "complete" })}\n`,
      "utf8"
    );

    await delay(650);
    controller.abort();
    await following;

    assert.match(output, /Warning: \d+ bytes arrived between log polls/u);
    assert.match(output, /INFO complete/u);
    assert.doesNotMatch(output, /discarded-suffix/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("JSON follow starts with a documented frame shape", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-json-${process.pid}-${Date.now()}`);
  const previousDataDir = process.env.DESKCUE_DATA_DIR;

  try {
    process.env.DESKCUE_DATA_DIR = directory;
    const controller = new AbortController();
    let output = "";
    const following = runLogsCommand({
      follow: true,
      io: {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      json: true,
      lines: 10,
      signal: controller.signal
    });

    controller.abort();
    await following;
    const frame = JSON.parse(output.trim());

    assert.equal(frame.command, "logs");
    assert.equal(frame.ok, true);
    assert.equal(frame.record, null);
    assert.equal(frame.schemaVersion, 1);
    assert.equal(frame.state, "following");
    assert.equal(typeof frame.path, "string");
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    await rm(directory, { force: true, recursive: true });
  }
});

test("follow joins an incomplete initial JSONL record with its later continuation", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-initial-partial-${process.pid}-${Date.now()}`);
  const previousDataDir = process.env.DESKCUE_DATA_DIR;
  const logFile = join(directory, "service", "logs", "daemon.jsonl");

  try {
    process.env.DESKCUE_DATA_DIR = directory;
    await mkdir(join(directory, "service", "logs"), { recursive: true });
    await writeFile(logFile, '{"message":"hel', "utf8");
    const controller = new AbortController();
    let output = "";
    const following = runLogsCommand({
      follow: true,
      io: {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      json: true,
      lines: 10,
      signal: controller.signal
    });

    await appendFile(logFile, 'lo"}\n', "utf8");
    await delay(650);
    controller.abort();
    await following;
    const frames = output.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    const records = frames.flatMap((frame) => frame.record ? [frame.record] : []);

    assert.deepEqual(records, [{ message: "hello" }]);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    await rm(directory, { force: true, recursive: true });
  }
});

test("follow catches a record appended after the initial tail snapshot", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-start-race-${process.pid}-${Date.now()}`);
  const previousDataDir = process.env.DESKCUE_DATA_DIR;
  const logFile = join(directory, "service", "logs", "daemon.jsonl");

  try {
    process.env.DESKCUE_DATA_DIR = directory;
    await mkdir(join(directory, "service", "logs"), { recursive: true });
    await writeFile(logFile, `${JSON.stringify({ message: "initial" })}\n`, "utf8");
    const tail = readLogTail(10);

    await appendFile(logFile, `${JSON.stringify({ message: "raced" })}\n`, "utf8");
    const controller = new AbortController();
    let output = "";
    const following = followLogs(
      tail.path,
      {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      true,
      controller.signal,
      undefined,
      tail.pendingText,
      tail.fileSize,
      tail.endAnchor
    );

    await delay(50);
    controller.abort();
    await following;
    const frames = output.trim().split(/\r?\n/u).map((line) => JSON.parse(line));

    assert.deepEqual(frames.map((frame) => frame.record.message), ["raced"]);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    await rm(directory, { force: true, recursive: true });
  }
});

test("follow detects same-path truncate and regrow before its first poll", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-regrow-${process.pid}-${Date.now()}`);
  const previousDataDir = process.env.DESKCUE_DATA_DIR;
  const logFile = join(directory, "service", "logs", "daemon.jsonl");

  try {
    process.env.DESKCUE_DATA_DIR = directory;
    await mkdir(join(directory, "service", "logs"), { recursive: true });
    await writeFile(logFile, `${JSON.stringify({ message: "old" })}\n`, "utf8");
    const tail = readLogTail(10);

    await writeFile(
      logFile,
      `${JSON.stringify({ level: "info", message: "replacement-is-longer-than-old" })}\n`,
      "utf8"
    );

    const controller = new AbortController();
    let output = "";
    const following = followLogs(
      tail.path,
      {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      true,
      controller.signal,
      undefined,
      tail.pendingText,
      tail.fileSize,
      tail.endAnchor
    );

    await delay(50);
    controller.abort();
    await following;
    const frames = output.trim().split(/\r?\n/u).map((line) => JSON.parse(line));

    assert.deepEqual(frames.map((frame) => frame.record), [{
      level: "info",
      message: "replacement-is-longer-than-old"
    }]);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    await rm(directory, { force: true, recursive: true });
  }
});

test("follow clears an initial partial record when the file was truncated before construction", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-partial-truncate-${process.pid}-${Date.now()}`);
  const previousDataDir = process.env.DESKCUE_DATA_DIR;
  const logFile = join(directory, "service", "logs", "daemon.jsonl");

  try {
    process.env.DESKCUE_DATA_DIR = directory;
    await mkdir(join(directory, "service", "logs"), { recursive: true });
    await writeFile(logFile, '{"message":"stale', "utf8");
    const tail = readLogTail(10);

    await writeFile(logFile, "", "utf8");
    const controller = new AbortController();
    let output = "";
    const following = followLogs(
      tail.path,
      {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      true,
      controller.signal,
      undefined,
      tail.pendingText,
      tail.fileSize,
      tail.endAnchor
    );

    await appendFile(logFile, `${JSON.stringify({ message: "fresh" })}\n`, "utf8");
    await delay(650);
    controller.abort();
    await following;
    const frames = output.trim().split(/\r?\n/u).map((line) => JSON.parse(line));

    assert.deepEqual(frames.map((frame) => frame.record), [{ message: "fresh" }]);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    await rm(directory, { force: true, recursive: true });
  }
});

test("JSON follow frames a transient read error and subsequent recovery", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-recovery-${process.pid}-${Date.now()}`);
  const logFile = join(directory, "daemon.jsonl");

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(logFile, "", "utf8");
    const controller = new AbortController();
    let failNextRead = true;
    let output = "";
    const following = followLogs(
      logFile,
      {
        stderr() {},
        stdout(text) {
          output += text;
        }
      },
      true,
      controller.signal,
      (path, start, end) => {
        if (failNextRead) {
          failNextRead = false;
          throw new Error("Injected read failure.");
        }

        return readFileSync(path).subarray(start, end).toString("utf8");
      }
    );

    await appendFile(logFile, `${JSON.stringify({ message: "first" })}\n`, "utf8");
    await delay(650);
    await appendFile(logFile, `${JSON.stringify({ message: "second" })}\n`, "utf8");
    await delay(650);
    controller.abort();
    await following;
    const frames = output.trim().split(/\r?\n/u).map((line) => JSON.parse(line));

    assert.equal(frames[0].ok, false);
    assert.equal(frames[0].state, "read_error");
    assert.equal(frames[0].error.code, "log_read_failed");
    assert.equal(frames[0].error.retryable, true);
    assert.equal(frames[1].ok, true);
    assert.equal(frames[1].state, "recovered");
    assert.deepEqual(frames.slice(2).map((frame) => frame.record.message), ["first", "second"]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("human follow errors cannot inject terminal control sequences or lines", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-safe-error-${process.pid}-${Date.now()}`);
  const logFile = join(directory, "daemon.jsonl");

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(logFile, "", "utf8");
    const controller = new AbortController();
    let stderr = "";
    const following = followLogs(
      logFile,
      {
        stderr(text) {
          stderr += text;
        },
        stdout() {}
      },
      false,
      controller.signal,
      () => {
        throw new Error("Read failed.\u001b]0;spoofed\u0007\nForged line.");
      }
    );

    await appendFile(logFile, `${JSON.stringify({ message: "trigger" })}\n`, "utf8");
    await delay(650);
    controller.abort();
    await following;

    assert.doesNotMatch(stderr, /\u001b/u);
    assert.match(stderr, /Read failed\. Forged line\./u);
    assert.equal(stderr.trim().split(/\r?\n/u).length, 1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("follow terminates when stderr applies backpressure to repeated read errors", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-stderr-backpressure-${process.pid}-${Date.now()}`);
  const logFile = join(directory, "daemon.jsonl");

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(logFile, "", "utf8");
    const following = followLogs(
      logFile,
      {
        stderr() {
          return false;
        },
        stdout() {}
      },
      false,
      new AbortController().signal,
      () => {
        throw new Error("Injected read failure.");
      }
    );

    await appendFile(logFile, `${JSON.stringify({ message: "trigger" })}\n`, "utf8");
    await assert.rejects(following, /output consumer could not keep up/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("follow terminates instead of buffering unbounded output under stdout backpressure", async () => {
  const directory = join(tmpdir(), `deskcue-cli-follow-backpressure-${process.pid}-${Date.now()}`);
  const logFile = join(directory, "daemon.jsonl");

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(logFile, "", "utf8");
    const following = followLogs(logFile, {
      stderr() {},
      stdout() {
        return false;
      }
    }, true, new AbortController().signal);

    await appendFile(logFile, `${JSON.stringify({ message: "too-fast" })}\n`, "utf8");
    await assert.rejects(following, /output consumer could not keep up/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
