import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readCompactTranscriptLinesFromIndexedHints,
  readCompactTranscriptLinesFromLineOffset,
  readFullTranscriptLineBreakSnapshot
} from "./codexTranscriptCompactReader.ts";

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
    },
    {
      type: "event_msg",
      timestamp: "2026-08-05T10:00:06.000Z",
      payload: {
        type: "item_completed",
        item: {
          type: "FileChange",
          status: "completed",
          changes: { "src/modern.ts": { type: "update" } }
        }
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
          count: 2,
          label: "Changes",
          range: { end: 6, prefix: "session-compact-", start: 5 }
        }
      ]
    );

    assert.equal(result.lines.length, 0);
    assert.equal(result.readLineCount, 7);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("keeps large reordered FileChange records and rejects incomplete or noncanonical records", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-large-file-change-"));
  const filePath = path.join(tempDir, "session.jsonl");
  const item = {
    changes: {
      "src/large.ts": {
        type: "update",
        unified_diff: "x".repeat(300_000)
      }
    },
    type: "FileChange"
  };

  const valid = JSON.stringify({
    payload: { item, type: "item_completed" },
    padding: "x".repeat(300_000),
    timestamp: "2026-08-05T10:00:00.000Z",
    type: "event_msg"
  });
  const missingRootType = JSON.stringify({
    payload: { item, type: "item_completed" },
    timestamp: "2026-08-05T10:00:01.000Z"
  });
  const incomplete = JSON.stringify({
    type: "event_msg",
    timestamp: "2026-08-05T10:00:02.000Z",
    payload: { type: "item_completed", item }
  }).slice(0, -1);
  const mismatchedCloser = `${valid.slice(0, -1)}]`;
  const malformedSyntax = valid.replace('"padding":', '"padding"::');

  await writeFile(
    filePath,
    `${valid}\n${missingRootType}\n${mismatchedCloser}\n${malformedSyntax}\n${incomplete}`,
    "utf8"
  );

  try {
    const result = await readCompactTranscriptLinesFromLineOffset(
      filePath,
      { byteOffset: 0, lineIndex: 0 },
      "session-large-file-change"
    );

    assert.ok(result.entries);
    assert.ok(result.lines);

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]?.sourceEntryCount, 1);
    assert.deepEqual(result.entries[0]?.sourceEntryRanges, [{
      end: 0,
      prefix: "session-large-file-change-",
      start: 0
    }]);
    assert.equal(result.lines.length, 0);
    assert.equal(result.readLineCount, 5);

    const fileStat = await stat(filePath);
    const snapshot = await readFullTranscriptLineBreakSnapshot(filePath, fileStat, {
      includeChatMessageOffsets: true,
      includeLineHints: true,
      includeOffsets: true
    });
    const indexedResult = await readCompactTranscriptLinesFromIndexedHints(
      filePath,
      snapshot,
      { byteOffset: 0, lineIndex: 0 },
      "session-large-file-change"
    );

    assert.equal(snapshot.lineHintsComplete, true);
    assert.equal(indexedResult?.entries?.[0]?.sourceEntryCount, 1);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("indexes a FileChange line that crosses the tail hint boundary", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-crossing-file-change-"));
  const filePath = path.join(tempDir, "session.jsonl");
  const line = JSON.stringify({
    payload: {
      item: {
        changes: {
          "src/large.ts": {
            type: "update",
            unified_diff: "x".repeat(16 * 1024 * 1024)
          }
        },
        type: "FileChange"
      },
      type: "item_completed"
    },
    timestamp: "2026-08-05T10:00:00.000Z",
    type: "event_msg"
  });

  await writeFile(filePath, `${line}\n`, "utf8");

  try {
    const fileStat = await stat(filePath);
    const snapshot = await readFullTranscriptLineBreakSnapshot(filePath, fileStat, {
      includeChatMessageOffsets: true,
      includeLineHints: true,
      includeOffsets: true
    });
    const result = await readCompactTranscriptLinesFromIndexedHints(
      filePath,
      snapshot,
      { byteOffset: 0, lineIndex: 0 },
      "session-crossing-file-change"
    );

    assert.equal(snapshot.lineHintsComplete, true);
    assert.equal(snapshot.compactLineSpans?.[0]?.kind, "changes");
    assert.equal(result?.entries?.[0]?.sourceEntryCount, 1);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("reads a reordered timestamp beyond the indexed hint prefix", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-late-timestamp-"));
  const filePath = path.join(tempDir, "session.jsonl");
  const timestamp = "2026-09-02T12:34:56.000Z";
  const line = JSON.stringify({
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        type: "FileChange",
        changes: {
          "src/late-timestamp.ts": {
            type: "update",
            unified_diff: "@@ -1 +1 @@\n-old\n+new"
          }
        }
      }
    },
    padding: "x".repeat(600_000),
    timestamp
  });

  await writeFile(filePath, `${line}\n`, "utf8");

  try {
    const fileStat = await stat(filePath);
    const snapshot = await readFullTranscriptLineBreakSnapshot(filePath, fileStat, {
      includeChatMessageOffsets: true,
      includeLineHints: true,
      includeOffsets: true
    });
    const result = await readCompactTranscriptLinesFromIndexedHints(
      filePath,
      snapshot,
      { byteOffset: 0, lineIndex: 0 },
      "session-late-timestamp"
    );

    assert.equal(snapshot.compactLineSpans?.[0]?.timestamp, timestamp);
    assert.equal(result?.entries?.[0]?.timestamp, timestamp);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("does not index a malformed large line as a chat message", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-malformed-chat-"));
  const filePath = path.join(tempDir, "session.jsonl");
  const validUser = JSON.stringify({
    type: "event_msg",
    timestamp: "2026-09-02T12:00:00.000Z",
    payload: { type: "user_message", message: "Valid prompt" }
  });
  const malformedAssistant = JSON.stringify({
    type: "response_item",
    timestamp: "2026-09-02T12:00:01.000Z",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "x".repeat(300_000) }]
    },
    padding: true
  }).replace('"padding":', '"padding"::');
  const validAssistant = JSON.stringify({
    type: "response_item",
    timestamp: "2026-09-02T12:00:02.000Z",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Valid answer" }]
    }
  });

  await writeFile(filePath, `${validUser}\n${malformedAssistant}\n${validAssistant}\n`, "utf8");

  try {
    const fileStat = await stat(filePath);
    const snapshot = await readFullTranscriptLineBreakSnapshot(filePath, fileStat, {
      includeChatMessageOffsets: true,
      includeLineHints: true,
      includeOffsets: true
    });

    assert.equal(snapshot.lineHintsComplete, true);
    assert.deepEqual(
      snapshot.chatMessageLineOffsets?.map((offset) => offset.lineIndex),
      [0, 2]
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("does not index a large non-chat line with nested chat discriminants", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-nested-chat-impostor-"));
  const filePath = path.join(tempDir, "session.jsonl");
  const validUser = JSON.stringify({
    type: "event_msg",
    timestamp: "2026-09-02T12:00:00.000Z",
    payload: { type: "user_message", message: "Valid prompt" }
  });
  const nonChatEvent = JSON.stringify({
    type: "event_msg",
    timestamp: "2026-09-02T12:00:01.000Z",
    payload: {
      type: "task_complete",
      metadata: {
        nested: { type: "user_message" },
        padding: "x".repeat(300_000)
      }
    }
  });
  const validAssistant = JSON.stringify({
    type: "response_item",
    timestamp: "2026-09-02T12:00:02.000Z",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Valid answer" }]
    }
  });

  await writeFile(filePath, `${validUser}\n${nonChatEvent}\n${validAssistant}\n`, "utf8");

  try {
    const fileStat = await stat(filePath);
    const snapshot = await readFullTranscriptLineBreakSnapshot(filePath, fileStat, {
      includeChatMessageOffsets: true,
      includeLineHints: true,
      includeOffsets: true
    });

    assert.deepEqual(
      snapshot.chatMessageLineOffsets?.map((offset) => offset.lineIndex),
      [0, 2]
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("indexes a large final response with a nested commentary phase", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-nested-commentary-"));
  const filePath = path.join(tempDir, "session.jsonl");
  const finalResponse = JSON.stringify({
    type: "response_item",
    timestamp: "2026-09-02T12:00:00.000Z",
    payload: {
      type: "message",
      role: "assistant",
      metadata: {
        phase: "commentary",
        padding: "x".repeat(300_000)
      },
      content: [{ type: "output_text", text: "Valid final answer" }]
    }
  });

  await writeFile(filePath, `${finalResponse}\n`, "utf8");

  try {
    const fileStat = await stat(filePath);
    const snapshot = await readFullTranscriptLineBreakSnapshot(filePath, fileStat, {
      includeChatMessageOffsets: true,
      includeLineHints: true,
      includeOffsets: true
    });

    assert.deepEqual(
      snapshot.chatMessageLineOffsets?.map((offset) => offset.lineIndex),
      [0]
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("indexes large chat messages with direct discriminants beyond the hint prefix", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-late-chat-shape-"));
  const filePath = path.join(tempDir, "session.jsonl");
  const lines = [
    {
      type: "response_item",
      padding: "x".repeat(300_000),
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Late response payload" }]
      }
    },
    {
      type: "response_item",
      payload: {
        padding: "x".repeat(300_000),
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Late response discriminants" }]
      }
    },
    {
      type: "event_msg",
      padding: "x".repeat(300_000),
      payload: { type: "user_message", message: "Late event payload" }
    },
    {
      type: "event_msg",
      payload: {
        padding: "x".repeat(300_000),
        type: "user_message",
        message: "Late event discriminant"
      }
    }
  ].map((line, index) => JSON.stringify({
    timestamp: `2026-09-02T12:00:0${index}.000Z`,
    ...line
  }));

  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");

  try {
    const fileStat = await stat(filePath);
    const snapshot = await readFullTranscriptLineBreakSnapshot(filePath, fileStat, {
      includeChatMessageOffsets: true,
      includeLineHints: true,
      includeOffsets: true
    });

    assert.deepEqual(
      snapshot.chatMessageLineOffsets?.map((offset) => offset.lineIndex),
      [0, 1, 2, 3]
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("indexes FileChange hints without requesting chat message offsets", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-hints-only-"));
  const filePath = path.join(tempDir, "session.jsonl");
  const line = JSON.stringify({
    type: "event_msg",
    timestamp: "2026-09-02T12:00:00.000Z",
    payload: {
      type: "item_completed",
      item: {
        type: "FileChange",
        changes: {
          "src/hints-only.ts": {
            type: "update",
            unified_diff: "@@ -1 +1 @@\n-old\n+new"
          }
        }
      }
    }
  });

  await writeFile(filePath, `${line}\n`, "utf8");

  try {
    const fileStat = await stat(filePath);
    const snapshot = await readFullTranscriptLineBreakSnapshot(filePath, fileStat, {
      includeChatMessageOffsets: false,
      includeLineHints: true,
      includeOffsets: true
    });

    assert.equal(snapshot.chatMessageLineOffsets, undefined);
    assert.equal(snapshot.lineHintsComplete, true);
    assert.equal(snapshot.compactLineSpans?.[0]?.kind, "changes");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
