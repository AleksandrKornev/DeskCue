import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCodexTranscriptRawTailIo } from "./codexTranscriptRawTailIo.ts";
import { createCodexTranscriptWindowIo } from "./codexTranscriptWindowIo.ts";
import type { TranscriptLineIndexReadOptions } from "./index/codexTranscriptLineIndex.ts";

function snapshot(size: number, mtimeMs: number) {
  return {
    lineBreakCount: 3,
    mtimeMs,
    size
  };
}

test("reads a byte tail without exposing its incomplete leading line", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-codex-window-io-"));
  const filePath = join(directory, "transcript.jsonl");

  try {
    await writeFile(filePath, "zero\none\ntwo\nthree\n", "utf-8");
    const rawTailIo = createCodexTranscriptRawTailIo({
      async countLineBreaks() {
        return 4;
      }
    });

    const exactTail = await rawTailIo.readTranscriptTail(filePath, 11);
    const relativeTail = await rawTailIo.readTranscriptTail(filePath, 11, undefined, {
      lineIndexOffset: "tail-relative"
    });

    assert.equal(exactTail.raw, "two\nthree\n");
    assert.equal(exactTail.lineIndexOffset, 2);
    assert.equal(relativeTail.raw, exactTail.raw);
    assert.equal(relativeTail.lineIndexOffset, 0);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("uses the injected line index for exact byte offsets and sparse line reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-codex-window-index-"));
  const filePath = join(directory, "transcript.jsonl");

  try {
    await writeFile(filePath, "alpha\nbravo\ncharlie\n", "utf-8");
    const fileStat = await stat(filePath);
    const requestedOptions: TranscriptLineIndexReadOptions[] = [];
    const windowIo = createCodexTranscriptWindowIo({
      async readSnapshot(_filePath, currentStat, options) {
        requestedOptions.push(options ?? {});
        return {
          ...snapshot(currentStat.size, currentStat.mtimeMs),
          lineOffsets: [
            { byteOffset: 0, lineIndex: 0 },
            { byteOffset: 12, lineIndex: 2 }
          ]
        };
      }
    });

    assert.equal(
      await windowIo.readCodexTranscriptLineByteOffset(filePath, fileStat, 1),
      6
    );
    assert.equal(
      await windowIo.readCodexTranscriptLineByteOffset(filePath, fileStat, 2),
      12
    );
    assert.deepEqual(
      await windowIo.readTranscriptLinesByIndexes(filePath, new Set([1, 2, 99])),
      [
        { index: 1, line: "bravo" },
        { index: 2, line: "charlie" }
      ]
    );
    assert.deepEqual(
      requestedOptions,
      [
        { requireOffsets: true },
        { requireOffsets: true },
        { requireOffsets: true }
      ]
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("aligns a planned byte window to a complete source line", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-codex-window-start-"));
  const filePath = join(directory, "transcript.jsonl");

  try {
    await writeFile(filePath, "first\nsecond\nthird\n", "utf-8");
    const windowIo = createCodexTranscriptWindowIo({
      async readSnapshot(_filePath, fileStat) {
        return snapshot(fileStat.size, fileStat.mtimeMs);
      }
    });

    assert.equal(
      await windowIo.findTranscriptTailWindowStartByteOffset(filePath, 15, 64),
      13
    );
    assert.equal(
      await windowIo.findTranscriptTailWindowStartByteOffset(filePath, 0, 64),
      0
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
