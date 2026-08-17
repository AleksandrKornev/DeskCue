import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findStringField,
  firstTranscriptText,
  parseClaudeTranscript,
  parseClaudeTranscriptLines,
  safeParseJson
} from "./claudeTranscript.ts";
import { readClaudeTranscriptByteOffset } from "./claudeTranscriptHydration.ts";
import {
  readClaudeTranscriptLinesAtOffsets,
  readClaudeTranscriptPreviousLines,
  readClaudeTranscriptTailLines,
  readClaudeTranscriptWindowLines
} from "./claudeTranscriptReader.ts";
import { deriveSourceAgentTurnState } from "../../sourceAgentTurnState.ts";

test("parses Claude JSONL transcript and skips invalid entries", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-"));
  const filePath = path.join(tempDir, "session.jsonl");

  await writeFile(
    filePath,
    [
      JSON.stringify({
        timestamp: "2026-06-22T08:00:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Build the flow" }]
        }
      }),
      "{not-json}",
      JSON.stringify({
        created_at: "2026-06-22T08:01:00.000Z",
        result: {
          role: "assistant",
          content: "Done"
        }
      })
    ].join("\n"),
    "utf8"
  );

  try {
    const transcript = await parseClaudeTranscript(filePath, "claude-1");

    assert.equal(transcript.length, 2);
    assert.equal(transcript[0]?.id, "claude-1-0");
    assert.equal(transcript[0]?.role, "user");
    assert.equal(transcript[0]?.text, "Build the flow");
    assert.equal(transcript[1]?.id, "claude-1-2");
    assert.equal(transcript[1]?.role, "assistant");
    assert.equal(transcript[1]?.text, "Done");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("normalizes Claude thinking and tool blocks", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-"));
  const filePath = path.join(tempDir, "session.jsonl");

  await writeFile(
    filePath,
    [
      JSON.stringify({
        timestamp: "2026-06-22T08:00:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "Checking the project shape" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-06-22T08:00:01.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_read",
              name: "Read",
              input: { file_path: "D:\\work\\repo\\README.md" }
            }
          ]
        }
      }),
      JSON.stringify({
        timestamp: "2026-06-22T08:00:02.000Z",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_read",
              content: "1\\t# README"
            }
          ]
        }
      })
    ].join("\n"),
    "utf8"
  );

  try {
    const transcript = await parseClaudeTranscript(filePath, "claude-1");

    assert.equal(transcript.length, 3);
    assert.equal(transcript[0]?.role, "commentary");
    assert.equal(transcript[0]?.phase, "thinking");
    assert.equal(transcript[0]?.text, "Checking the project shape");
    assert.equal(transcript[1]?.role, "tool");
    assert.equal(transcript[1]?.text, "Read");
    assert.equal(transcript[1]?.parts?.[0]?.type, "tool_call");
    assert.equal(transcript[2]?.role, "tool");
    assert.equal(transcript[2]?.text, "1\\t# README");
    assert.equal(transcript[2]?.parts?.[0]?.type, "tool_result");
    assert.equal(
      transcript[2]?.parts?.[0]?.type === "tool_result" &&
        transcript[2].parts[0].toolName,
      "Read"
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("splits a text preamble from a tool_use block in the same Claude message", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-"));
  const filePath = path.join(tempDir, "session.jsonl");

  await writeFile(
    filePath,
    JSON.stringify({
      timestamp: "2026-06-22T08:00:00.000Z",
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Let me check that file." },
          {
            type: "tool_use",
            id: "toolu_read",
            name: "Read",
            input: { file_path: "D:\\work\\repo\\README.md" }
          }
        ]
      }
    }),
    "utf8"
  );

  try {
    const transcript = await parseClaudeTranscript(filePath, "claude-1");

    assert.equal(transcript.length, 2);
    assert.equal(transcript[0]?.role, "assistant");
    assert.equal(transcript[0]?.text, "Let me check that file.");
    assert.equal(transcript[0]?.phase, "non_final");
    assert.equal(transcript[0]?.id, "claude-1-0-text");
    assert.equal(transcript[1]?.role, "tool");
    assert.equal(transcript[1]?.id, "claude-1-0-tool");
    assert.equal(transcript[1]?.parts?.[0]?.type, "tool_call");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("keeps a Claude turn active across separately serialized preamble and tool records", () => {
  const timestamp = (offsetMs: number) => new Date(Date.now() - 5_000 + offsetMs).toISOString();
  const records = [
    {
      timestamp: timestamp(0),
      type: "user",
      message: { role: "user", content: "Check the parser" }
    },
    {
      timestamp: timestamp(1_000),
      type: "assistant",
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [{ type: "text", text: "I will inspect the file." }]
      }
    },
    {
      timestamp: timestamp(2_000),
      type: "assistant",
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "toolu_read", name: "Read", input: {} }]
      }
    },
    {
      timestamp: timestamp(3_000),
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_read", content: "file" }]
      }
    },
    {
      timestamp: timestamp(4_000),
      type: "assistant",
      message: {
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "The parser is fixed." }]
      }
    }
  ];
  const lines = records.map((record, index) => ({
    index: `b${index * 100}`,
    line: JSON.stringify(record)
  }));

  for (let lineCount = 1; lineCount < lines.length; lineCount += 1) {
    const transcript = parseClaudeTranscriptLines(lines.slice(0, lineCount), "claude-real");
    assert.equal(deriveSourceAgentTurnState({ transcript }).phase, "active");
  }

  const transcript = parseClaudeTranscriptLines(lines, "claude-real");
  const preamble = transcript.find((entry) => entry.text === "I will inspect the file.");
  const completed = transcript.at(-1);

  assert.equal(preamble?.role, "assistant");
  assert.equal(preamble?.phase, "non_final");
  assert.equal(completed?.role, "system");
  assert.equal(completed?.text, "Turn completed");
  assert.equal(completed?.id, "claude-real-b400-turn-completed");
  assert.equal(deriveSourceAgentTurnState({ transcript }).phase, "completed");
});

test("does not expose an encrypted Claude thinking signature as assistant text", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-"));
  const filePath = path.join(tempDir, "session.jsonl");

  await writeFile(
    filePath,
    [
      JSON.stringify({
        timestamp: "2026-07-30T16:25:00.000Z",
        message: {
          role: "assistant",
          content: [{
            type: "thinking",
            thinking: "",
            signature: "ErQQCokBCBAYAipAsMG6blcXln3o4OO+M95V/TovIqahfzVBsTwtaIn"
          }],
          model: "claude-sonnet-5"
        }
      }),
      JSON.stringify({
        timestamp: "2026-07-30T16:25:00.500Z",
        message: {
          role: "assistant",
          content: [{
            type: "thinking",
            thinking: "Internal reasoning",
            signature: "signature"
          }, {
            type: "text",
            text: "Visible reply after reasoning"
          }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-07-30T16:25:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Visible Claude reply" }]
        }
      })
    ].join("\n"),
    "utf8"
  );

  try {
    const transcript = await parseClaudeTranscript(filePath, "claude-1");

    assert.deepEqual(transcript.map((entry) => ({ role: entry.role, text: entry.text })), [
      { role: "assistant", text: "Visible reply after reasoning" },
      { role: "assistant", text: "Visible Claude reply" }
    ]);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("skips Claude's synthetic no-response acknowledgement", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-"));
  const filePath = path.join(tempDir, "session.jsonl");

  await writeFile(
    filePath,
    JSON.stringify({
      timestamp: "2026-08-05T06:11:50.000Z",
      message: {
        model: "<synthetic>",
        role: "assistant",
        content: [{ type: "text", text: "No response requested." }]
      }
    }),
    "utf8"
  );

  try {
    assert.deepEqual(await parseClaudeTranscript(filePath, "claude-1"), []);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("retains lifecycle completion for Claude's terminal no-response acknowledgement", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-no-response-"));
  const filePath = path.join(tempDir, "session.jsonl");

  await writeFile(
    filePath,
    JSON.stringify({
      timestamp: "2026-08-05T06:11:50.000Z",
      message: {
        model: "<synthetic>",
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "No response requested." }]
      }
    }),
    "utf8"
  );

  try {
    const transcript = await parseClaudeTranscript(filePath, "claude-1");
    assert.deepEqual(transcript.map(({ role, text }) => ({ role, text })), [
      { role: "system", text: "Turn completed" }
    ]);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("skips Claude resume metadata without hiding the real queued prompt", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-resume-meta-"));
  const filePath = path.join(tempDir, "session.jsonl");

  await writeFile(
    filePath,
    [
      JSON.stringify({
        timestamp: "2026-08-06T17:48:40.135Z",
        type: "user",
        isMeta: true,
        message: {
          role: "user",
          content: [{ type: "text", text: "Continue from where you left off." }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-08-06T17:48:40.135Z",
        type: "assistant",
        message: {
          model: "<synthetic>",
          role: "assistant",
          content: [{ type: "text", text: "No response requested." }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-08-06T17:48:40.224Z",
        type: "user",
        message: {
          role: "user",
          content: "Real prompt from DeskCue"
        }
      }),
      JSON.stringify({
        timestamp: "2026-08-06T17:49:16.223Z",
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Real Claude reply" }]
        }
      })
    ].join("\n"),
    "utf8"
  );

  try {
    const transcript = await parseClaudeTranscript(filePath, "claude-resume", {
      chatMessageTail: 2
    });
    assert.deepEqual(transcript.map(({ role, text }) => ({ role, text })), [
      { role: "user", text: "Real prompt from DeskCue" },
      { role: "assistant", text: "Real Claude reply" }
    ]);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("reads a bounded Claude chat tail without loading an adversarial prefix", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-bounded-tail-"));
  const filePath = path.join(tempDir, "session.jsonl");
  const tail = Array.from({ length: 20 }, (_, index) => JSON.stringify({
    timestamp: `2026-08-05T06:${String(index).padStart(2, "0")}:00.000Z`,
    message: {
      role: index % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `message-${index}` }]
    }
  }));
  await writeFile(
    filePath,
    `${"x".repeat(12 * 1024 * 1024)}\n${tail.join("\n")}\n`,
    "utf8"
  );

  try {
    const transcript = await parseClaudeTranscript(filePath, "claude-large", {
      chatMessageTail: 3
    });

    assert.deepEqual(transcript.map((entry) => entry.text), [
      "message-17",
      "message-18",
      "message-19"
    ]);
    assert.equal(transcript.every((entry) => entry.id.startsWith("claude-large-b")), true);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("applies transcriptTail while retaining tool context inside the bounded window", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-transcript-tail-"));
  const filePath = path.join(tempDir, "session.jsonl");
  await writeFile(
    filePath,
    Array.from({ length: 40 }, (_, index) => JSON.stringify({
      timestamp: `2026-08-05T06:00:${String(index).padStart(2, "0")}.000Z`,
      message: {
        role: index % 2 === 0 ? "user" : "assistant",
        content: [{ type: "text", text: `entry-${index}` }]
      }
    })).join("\n"),
    "utf8"
  );

  try {
    const transcript = await parseClaudeTranscript(filePath, "claude-tail", {
      transcriptTail: 4
    });
    assert.deepEqual(transcript.map((entry) => entry.text), [
      "entry-36",
      "entry-37",
      "entry-38",
      "entry-39"
    ]);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("extracts Claude summary fields from nested records", () => {
  const records = [
    {
      isMeta: true,
      message: {
        role: "user",
        content: [{ text: "Continue from where you left off." }]
      }
    },
    {
      meta: {
        cwd: "D:\\work\\repo",
        model: "claude-sonnet"
      },
      message: {
        role: "user",
        content: [{ text: "First user prompt" }]
      }
    }
  ];

  assert.equal(firstTranscriptText(records, "user"), "First user prompt");
  assert.equal(findStringField(records, ["cwd"]), "D:\\work\\repo");
  assert.equal(findStringField(records, ["model"]), "claude-sonnet");
  assert.equal(safeParseJson("{bad json}"), null);
});

test("hydrates Claude transcript entries and history windows by bounded byte offsets", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-hydration-"));
  const filePath = path.join(tempDir, "session.jsonl");
  const records = Array.from({ length: 300 }, (_, index) => JSON.stringify({
    timestamp: "2026-08-06T10:00:00.000Z",
    message: { role: index % 2 === 0 ? "user" : "assistant", content: `entry-${index}` }
  }));
  const content = `${records.join("\n")}\n`;
  await writeFile(filePath, content, "utf8");
  const targetOffset = Buffer.byteLength(`${records.slice(0, 180).join("\n")}\n`);

  try {
    const exact = await readClaudeTranscriptLinesAtOffsets(filePath, new Set([targetOffset]));
    assert.equal(exact.length, 1);
    assert.equal(exact[0]?.index, `b${targetOffset}`);
    assert.match(exact[0]?.line ?? "", /entry-180/);

    const window = await readClaudeTranscriptWindowLines(filePath, targetOffset, {
      maxLineCount: 301,
      overlapLineCount: 3
    });
    assert.equal(window?.some((line) => line.index === `b${targetOffset}`), true);
    assert.match(window?.[0]?.line ?? "", /entry-177/);

    const previous = await readClaudeTranscriptPreviousLines(filePath, targetOffset);
    assert.equal(previous?.lines.some((line) => /entry-179/.test(line.line)), true);

    const tail = await readClaudeTranscriptTailLines(filePath, (lines) => lines.length >= 4);
    assert.equal(tail.every((line) => String(line.index).startsWith("b")), true);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("reads byte offsets from derived Claude transcript entry ids", () => {
  assert.equal(
    readClaudeTranscriptByteOffset("claude.session", "claude.session-b123-text"),
    123
  );
  assert.equal(
    readClaudeTranscriptByteOffset("claude.session", "claude.session-b456-tool"),
    456
  );
  assert.equal(
    readClaudeTranscriptByteOffset(
      "claude.session",
      "claude.session-b789-turn-completed"
    ),
    789
  );
  assert.equal(
    readClaudeTranscriptByteOffset("claude.session", "claude.session-b123-unknown"),
    null
  );
});
