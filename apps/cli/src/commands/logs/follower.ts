import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
  unwatchFile,
  watchFile
} from "node:fs";
import type { CliIo } from "../../output.ts";
import {
  LogOutputBackpressureError,
  writeFollowReadError,
  writeFollowRecovered,
  writeLogLine,
  writeOversizedRecordNotice,
  writeTruncationNotice
} from "./presentation.ts";
import { isOversizedLogRecord } from "./records.ts";

type ReadFileRange = (path: string, start: number, end: number) => string;

const MAX_FOLLOW_READ_BYTES = 1024 * 1024;
const FOLLOW_ANCHOR_BYTES = 64;

function readFileRange(path: string, start: number, end: number) {
  if (end <= start) return "";

  const length = end - start;
  const buffer = Buffer.allocUnsafe(length);
  const descriptor = openSync(path, "r");

  try {
    const bytesRead = readSync(descriptor, buffer, 0, length, start);

    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}

class LogFollower {
  private anchor: string;
  private discardUntilNewline = false;
  private offset: number;
  private readErrorActive = false;
  private reading = Promise.resolve();
  private reject: ((error: unknown) => void) | null = null;
  private resolve: (() => void) | null = null;
  private settled = false;

  constructor(
    private readonly path: string,
    private readonly io: CliIo,
    private readonly json: boolean,
    private readonly signal: AbortSignal,
    private readonly readRange: ReadFileRange,
    private pendingText: string,
    initialOffset?: number,
    initialAnchor?: string
  ) {
    const currentSize = existsSync(path) ? statSync(path).size : 0;

    this.offset = initialOffset === undefined
      ? currentSize
      : initialOffset <= currentSize
        ? initialOffset
        : 0;
    if (initialOffset !== undefined && initialOffset > currentSize) this.pendingText = "";
    this.anchor = initialOffset === this.offset && initialAnchor !== undefined
      ? initialAnchor
      : this.readAnchor();
  }

  run() {
    return new Promise<void>((resolve, reject) => {
      this.reject = reject;
      this.resolve = resolve;
      if (this.signal.aborted) {
        this.settled = true;
        resolve();
        return;
      }

      watchFile(this.path, { interval: 500 }, this.onChange);
      this.signal.addEventListener("abort", this.finish, { once: true });

      if (existsSync(this.path)) {
        const current = statSync(this.path);

        this.queueRead(current, current);
      }
    });
  }

  private readonly finish = () => {
    if (this.settled) return;

    this.settled = true;
    unwatchFile(this.path, this.onChange);
    this.signal.removeEventListener("abort", this.finish);
    void this.reading.finally(() => this.resolve?.());
  };

  private fail(error: unknown) {
    if (this.settled) return;

    this.settled = true;
    unwatchFile(this.path, this.onChange);
    this.signal.removeEventListener("abort", this.finish);
    this.reject?.(error);
  }

  private readAnchor() {
    if (this.offset === 0) return "";

    return this.readRange(
      this.path,
      Math.max(0, this.offset - FOLLOW_ANCHOR_BYTES),
      this.offset
    );
  }

  private anchorMatches(currentSize: number) {
    if (this.offset === 0) return true;
    if (currentSize < this.offset) return false;

    return this.readAnchor() === this.anchor;
  }

  private readonly handleReadFailure = (error: unknown) => {
    if (error instanceof LogOutputBackpressureError) {
      this.fail(error);
      return;
    }

    this.readErrorActive = true;

    try {
      writeFollowReadError(this.io, this.json, this.path, error);
    } catch (writeError) {
      this.fail(writeError);
    }
  };

  private queueRead(
    current: import("node:fs").Stats,
    previous: import("node:fs").Stats
  ) {
    this.reading = this.reading
      .then(() => this.readAvailable(current, previous))
      .catch(this.handleReadFailure);
  }

  private readonly onChange = (
    current: import("node:fs").Stats,
    previous: import("node:fs").Stats
  ) => {
    this.queueRead(current, previous);
  };

  private readAvailable(
    current: import("node:fs").Stats,
    previous: import("node:fs").Stats
  ) {
    const replaced = current.ino !== previous.ino ||
      current.birthtimeMs !== previous.birthtimeMs ||
      !this.anchorMatches(current.size);

    if (replaced || current.size < this.offset) {
      this.anchor = "";
      this.discardUntilNewline = false;
      this.offset = 0;
      this.pendingText = "";
    }

    if (current.size <= this.offset) return;

    const previousOffset = this.offset;
    const start = Math.max(previousOffset, current.size - MAX_FOLLOW_READ_BYTES);
    let text = this.readRange(this.path, start, current.size);

    if (this.readErrorActive) {
      this.readErrorActive = false;
      writeFollowRecovered(this.io, this.json, this.path);
    }

    if (start > previousOffset) {
      this.pendingText = "";
      writeTruncationNotice(this.io, this.json, this.path, start - previousOffset);
      this.discardUntilNewline = true;
    }

    if (this.discardUntilNewline) {
      const newlineIndex = text.indexOf("\n");

      if (newlineIndex < 0) {
        this.offset = current.size;
        this.anchor = this.readAnchor();
        return;
      }

      text = text.slice(newlineIndex + 1);
      this.discardUntilNewline = false;
    }

    this.offset = current.size;
    this.anchor = this.readAnchor();
    const lines = `${this.pendingText}${text}`.split(/\r?\n/u);

    this.pendingText = lines.pop() ?? "";

    for (const line of lines) {
      if (!line) continue;

      if (isOversizedLogRecord(line)) {
        writeOversizedRecordNotice(this.io, this.json, this.path);
        continue;
      }

      writeLogLine(this.io, line, this.json, this.path);
    }

    if (isOversizedLogRecord(this.pendingText)) {
      this.pendingText = "";
      this.discardUntilNewline = true;
      writeOversizedRecordNotice(this.io, this.json, this.path);
    }
  }
}

export function followLogs(
  path: string,
  io: CliIo,
  json: boolean,
  signal: AbortSignal,
  readRange: ReadFileRange = readFileRange,
  pendingText = "",
  initialOffset?: number,
  initialAnchor?: string
) {
  return new LogFollower(
    path,
    io,
    json,
    signal,
    readRange,
    pendingText,
    initialOffset,
    initialAnchor
  ).run();
}
