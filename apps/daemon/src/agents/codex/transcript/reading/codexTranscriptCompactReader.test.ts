import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readCompactTranscriptLinesFromLineOffset } from "./codexTranscriptCompactReader.ts";

test("compacts indexed details, tools, and changes into stable counted source ranges", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-compact-reader-"));
  const filePath = path.join(tempDir, "session.jsonl");
  const largeCommentary = "d".repeat(256 * 1024 + 1);
  const lines = [
    ...[0, 1].map((index) => ({
      type: "response_item",
      timestamp: `2026-08-05T10:00:0${index}.000Z`,
      payload: {
        type: "message",
        role: "assistant",
        phase: "commentary",
        content: [{ type: "output_text", text: largeCommentary }]
      }
    })),
    ...[2, 3, 4].map((index) => ({
      type: "response_item",
      timestamp: `2026-08-05T10:00:0${index}.000Z`,
      payload: {
        type: "function_call_output",
        call_id: `call-${index}`,
        output: "tool output"
      }
    })),
    {
      type: "event_msg",
      timestamp: "2026-08-05T10:00:05.000Z",
      payload: {
        type: "patch_apply_end",
        success: true,
        changes: { "src/example.ts": { type: "update" } }
      }
    }
  ];

  await writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  try {
    const result = await readCompactTranscriptLinesFromLineOffset(
      filePath,
      { byteOffset: 0, lineIndex: 0 },
      "session-compact"
    );
    assert.ok(result.entries);
    assert.ok(result.lines);

    assert.deepEqual(
      result.entries.map((entry) => ({
        count: entry.sourceEntryCount,
        label: entry.parts?.find((part) => part.type === "status")?.label ??
          (entry.parts?.some((part) => part.type === "diff") ? "Changes" : null),
        range: entry.sourceEntryRanges?.[0]
      })),
      [
        {
          count: 2,
          label: "Details",
          range: { end: 1, prefix: "session-compact-", start: 0 }
        },
        {
          count: 3,
          label: "Tool events",
          range: { end: 4, prefix: "session-compact-", start: 2 }
        },
        {
          count: 1,
          label: "Changes",
          range: { end: 5, prefix: "session-compact-", start: 5 }
        }
      ]
    );
    assert.equal(result.lines.length, 0);
    assert.equal(result.readLineCount, 6);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
