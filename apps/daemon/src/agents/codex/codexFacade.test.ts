import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { daemonConfig } from "#config/daemonConfig";

import {
  getCodexSessionDetail,
  getCodexSessionRuntimeContext,
  getCodexTranscriptEntries,
  getCodexTranscriptPreviousWindow,
  getCodexTranscriptTailWindow,
  getCodexTranscriptWindow,
  readCodexSessionDetailReadMode
} from "./codexFacade.ts";

function jsonl(records: Array<Record<string, unknown>>) {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

test("reads beyond the fixed Codex tail when recent chat messages are before a tool-heavy tail", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-big.jsonl");
  const largeToolOutput = "x".repeat(5 * 1024 * 1024);

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-big",
      thread_name: "Tool-heavy transcript",
      updated_at: "2026-07-22T10:00:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-big",
          cwd: "D:\\work\\repo"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "Prompt before tools"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Answer before tools"
            }
          ]
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:02.000Z",
        payload: {
          type: "function_call_output",
          call_id: "call-heavy",
          output: largeToolOutput
        }
      }
    ]),
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    const detail = await getCodexSessionDetail("session-big", true, undefined, 2);

    assert.equal(detail?.transcript.some((entry) => entry.role === "user"), true);
    assert.equal(detail?.transcript.some((entry) => entry.role === "assistant"), true);
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("uses indexed lightweight Codex detail without parsing heavy activity payloads", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const originalDatabaseFilePath = daemonConfig.databaseFilePath;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const databaseFilePath = path.join(tempDir, "data", "deskcue.sqlite");
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-indexed-lightweight.jsonl");
  const largeToolOutput = `HYDRATE_TOOL_START\n${"x".repeat(1024 * 1024)}`;
  const diffText = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1 +1 @@",
    "-old",
    "+HYDRATE_DIFF_START"
  ].join("\n");

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-indexed-lightweight",
      thread_name: "Indexed lightweight transcript",
      updated_at: "2026-07-22T10:00:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    `${jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-indexed-lightweight",
          cwd: "D:\\work\\repo"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "Prompt before heavy activity"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Answer before heavy activity"
            }
          ]
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:02.000Z",
        payload: {
          type: "function_call_output",
          call_id: "call-heavy",
          output: largeToolOutput
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:02.500Z",
        payload: {
          type: "function_call_output",
          call_id: "call-heavy-second",
          output: "HYDRATE_TOOL_SECOND"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:03.000Z",
        payload: {
          type: "patch_apply_end",
          success: true,
          changes: {
            "src/example.ts": {
              type: "update",
              unified_diff: diffText
            }
          }
        }
      }
    ])}\n`,
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  daemonConfig.databaseFilePath = databaseFilePath;
  try {
    const detail = await getCodexSessionDetail(
      "session-indexed-lightweight",
      true,
      undefined,
      2,
      {
        includeContextCompactionCount: false,
        lineIndexOffset: "exact",
        readExpandedTailWhenMissingUser: false
      }
    );

    assert.equal(readCodexSessionDetailReadMode(detail), "indexed-detail");
    assert.equal(JSON.stringify(detail?.transcript).includes("HYDRATE_TOOL_START"), false);
    assert.equal(JSON.stringify(detail?.transcript).includes("HYDRATE_DIFF_START"), false);

    const compactTools = detail?.transcript.find((entry) =>
      entry.isCompact &&
      entry.role === "tool" &&
      entry.parts?.some((part) => part.type === "status" && part.label === "Tool events")
    );
    const compactChanges = detail?.transcript.find((entry) =>
      entry.isCompact &&
      entry.parts?.some((part) => part.type === "diff")
    );

    assert.deepEqual(compactTools?.sourceEntryRanges, [
      {
        end: 4,
        prefix: "session-indexed-lightweight-",
        start: 3
      }
    ]);
    assert.deepEqual(compactChanges?.sourceEntryRanges, [
      {
        end: 5,
        prefix: "session-indexed-lightweight-",
        start: 5
      }
    ]);

    const exactEntries = await getCodexTranscriptEntries(
      "session-indexed-lightweight",
      [
        "session-indexed-lightweight-3",
        "session-indexed-lightweight-4",
        "session-indexed-lightweight-5"
      ],
      true
    );
    const exactToolResultText = exactEntries
      .flatMap((entry) => entry.parts ?? [])
      .filter((part) => part.type === "tool_result")
      .map((part) => part.text)
      .join("\n");
    const exactDiff = exactEntries
      .flatMap((entry) => entry.parts ?? [])
      .find((part) => part.type === "diff");

    assert.equal(exactEntries.some((entry) => entry.isCompact), false);
    assert.equal(
      exactToolResultText.includes("HYDRATE_TOOL_START") &&
        exactToolResultText.includes("HYDRATE_TOOL_SECOND"),
      true
    );
    assert.equal(
      exactDiff?.type === "diff" &&
        exactDiff.text.includes("HYDRATE_DIFF_START"),
      true
    );

    const windowEntries = await getCodexTranscriptWindow(
      "session-indexed-lightweight",
      "session-indexed-lightweight-2",
      {
        maxLineCount: 8,
        overlapLineCount: 0
      }
    );
    assert.equal(JSON.stringify(windowEntries).includes("HYDRATE_TOOL_START"), false);
    assert.equal(JSON.stringify(windowEntries).includes("HYDRATE_DIFF_START"), false);
    assert.deepEqual(
      windowEntries?.map((entry) => entry.text),
      [
        "Answer before heavy activity",
        "2 tool entries hidden in live view",
        "Changes hidden in live view"
      ]
    );
    assert.deepEqual(
      windowEntries
        ?.filter((entry) => entry.isCompact)
        .map((entry) => entry.sourceEntryRanges),
      [
        [
          {
            end: 4,
            prefix: "session-indexed-lightweight-",
            start: 3
          }
        ],
        [
          {
            end: 5,
            prefix: "session-indexed-lightweight-",
            start: 5
          }
        ]
      ]
    );
    assert.equal(
      await getCodexTranscriptWindow(
        "session-indexed-lightweight",
        "other-session-2",
        {
          maxLineCount: 8,
          overlapLineCount: 0
        }
      ),
      null
    );
    assert.equal(
      await getCodexTranscriptWindow(
        "session-indexed-lightweight",
        "session-indexed-lightweight-2",
        {
          maxLineCount: 1,
          overlapLineCount: 0
        }
      ),
      null
    );

    const persistedIndex = JSON.parse(
      await readFile(
        path.join(path.dirname(databaseFilePath), "codex-transcript-line-counts.json"),
        "utf8"
      )
    ) as {
      snapshots: Array<{
        compactLineSpans?: Array<{ end: number; kind: string; start: number }>;
        filePath?: string;
        lineHintsComplete?: boolean;
      }>;
      version?: number;
    };
    const persistedSnapshot = persistedIndex.snapshots.find((snapshot) =>
      snapshot.filePath === sessionFilePath
    );

    assert.equal(persistedIndex.version, 6);
    assert.equal(persistedSnapshot?.lineHintsComplete, true);
    assert.deepEqual(
      persistedSnapshot?.compactLineSpans?.map(({ end, kind, start }) => ({ end, kind, start })),
      [
        {
          end: 4,
          kind: "tools",
          start: 3
        },
        {
          end: 5,
          kind: "changes",
          start: 5
        }
      ]
    );
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    daemonConfig.databaseFilePath = originalDatabaseFilePath;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("uses bounded exact Codex detail without indexed first-open scan", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const originalDatabaseFilePath = daemonConfig.databaseFilePath;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const databaseFilePath = path.join(tempDir, "data", "deskcue.sqlite");
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-bounded-exact.jsonl");
  const largeToolOutput = "x".repeat(1024 * 1024);

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-bounded-exact",
      thread_name: "Bounded exact transcript",
      updated_at: "2026-07-22T10:00:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-bounded-exact",
          cwd: "D:\\work\\repo"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:00.000Z",
        payload: {
          type: "function_call_output",
          call_id: "call-heavy",
          output: largeToolOutput
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:01.000Z",
        payload: {
          type: "user_message",
          message: "Recent prompt"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:02.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Recent answer"
            }
          ]
        }
      }
    ]),
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  daemonConfig.databaseFilePath = databaseFilePath;
  try {
    const detail = await getCodexSessionDetail(
      "session-bounded-exact",
      true,
      undefined,
      2,
      {
        includeContextCompactionCount: false,
        lineIndexOffset: "exact",
        preferBoundedTail: true,
        readExpandedTailWhenMissingUser: false
      }
    );

    assert.equal(readCodexSessionDetailReadMode(detail), "bounded-detail");
    assert.deepEqual(
      detail?.transcript.map((entry) => entry.id),
      ["session-bounded-exact-2", "session-bounded-exact-3"]
    );
    assert.deepEqual(
      detail?.transcript.map((entry) => entry.text),
      ["Recent prompt", "Recent answer"]
    );

    const persistedIndex = JSON.parse(
      await readFile(
        path.join(path.dirname(databaseFilePath), "codex-transcript-line-counts.json"),
        "utf8"
      )
    ) as {
      snapshots: Array<{
        compactLineSpans?: Array<{ end: number; kind: string; start: number }>;
        filePath?: string;
        lineHintsComplete?: boolean;
      }>;
    };
    const persistedSnapshot = persistedIndex.snapshots.find((snapshot) =>
      snapshot.filePath === sessionFilePath
    );

    assert.equal(persistedSnapshot?.lineHintsComplete, undefined);
    assert.equal(persistedSnapshot?.compactLineSpans, undefined);
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    daemonConfig.databaseFilePath = originalDatabaseFilePath;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("reads Codex source tail window with durable global source ids", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const originalDatabaseFilePath = daemonConfig.databaseFilePath;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const databaseFilePath = path.join(tempDir, "data", "deskcue.sqlite");
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-source-window.jsonl");
  const lineIndexPath = path.join(path.dirname(databaseFilePath), "codex-transcript-line-counts.json");
  const largeDetailsPayload = `WINDOW_DETAILS_START\n${"d".repeat(1024 * 1024)}`;
  const largeToolOutput = `WINDOW_TOOL_START\n${"t".repeat(1024 * 1024)}`;

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-source-window",
      thread_name: "Source window transcript",
      updated_at: "2026-07-22T10:00:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    `${jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-source-window",
          cwd: "D:\\work\\repo"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "Recent prompt"
        }
      },
      ...[
        "First live detail",
        "Second live detail",
        "Third live detail"
      ].map((text, index) => ({
        type: "response_item",
        timestamp: `2026-07-22T10:00:00.${String(100 + index).padStart(3, "0")}Z`,
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [{
            type: "output_text",
            text
          }]
        }
      })),
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [{
            type: "output_text",
            text: largeDetailsPayload
          }]
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:02.000Z",
        payload: {
          type: "function_call_output",
          call_id: "call-window",
          output: largeToolOutput
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:03.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Recent answer"
            }
          ]
        }
      }
    ])}\n`,
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  daemonConfig.databaseFilePath = databaseFilePath;
  try {
    const entries = await getCodexTranscriptTailWindow("session-source-window", {
      chatMessageTail: 2,
      force: true
    });
    const recentAnswerId = entries?.find((entry) => entry.text === "Recent answer")?.id;

    assert.equal(entries?.some((entry) => entry.text === "Recent prompt"), true);
    assert.equal(entries?.some((entry) => entry.text === "Recent answer"), true);
    assert.deepEqual(
      entries
        ?.filter((entry) => entry.phase === "commentary")
        .map((entry) => entry.text),
      ["First live detail", "Second live detail", "Third live detail"]
    );
    assert.equal(JSON.stringify(entries).includes("WINDOW_DETAILS_START"), false);
    assert.equal(JSON.stringify(entries).includes("WINDOW_TOOL_START"), false);
    assert.ok(recentAnswerId);

    const previousWindow = await getCodexTranscriptPreviousWindow(
      "session-source-window",
      recentAnswerId,
      { force: true }
    );
    assert.ok(previousWindow, `Expected previous window for ${recentAnswerId}`);
    assert.equal(previousWindow.entries.some((entry) => entry.text === "Recent prompt"), true);

    const compactDetails = entries?.find((entry) =>
      entry.isCompact &&
      entry.parts?.some((part) => part.type === "status" && part.label === "Details")
    );
    const compactTools = entries?.find((entry) =>
      entry.isCompact &&
      entry.parts?.some((part) => part.type === "status" && part.label === "Tool events")
    );
    assert.equal(compactDetails?.sourceEntryRanges?.[0]?.prefix, "session-source-window-");
    assert.equal(compactTools?.sourceEntryRanges?.[0]?.prefix, "session-source-window-");

    const toolRange = compactTools?.sourceEntryRanges?.[0];
    assert.ok(toolRange);
    const hydratedToolEntryId = `${toolRange.prefix}${toolRange.start}`;
    const hydrated = await getCodexTranscriptEntries(
      "session-source-window",
      [hydratedToolEntryId],
      true
    );
    assert.equal(hydrated[0]?.id, hydratedToolEntryId);
    assert.equal(JSON.stringify(hydrated).includes("WINDOW_TOOL_START"), true);
    const persistedIndex = JSON.parse(await readFile(lineIndexPath, "utf8")) as {
      snapshots: Array<{ filePath?: string; lineHintsComplete?: boolean }>;
    };
    assert.equal(
      persistedIndex.snapshots.some((snapshot) =>
        snapshot.filePath === sessionFilePath && snapshot.lineHintsComplete === true
      ),
      true
    );

    await appendFile(
      sessionFilePath,
      `${jsonl([
        ...Array.from({ length: 1_024 }, (_, index) => ({
          type: "response_item",
          timestamp: `2026-07-22T10:01:${String(index % 60).padStart(2, "0")}.000Z`,
          payload: {
            type: "function_call_output",
            call_id: `append-${index}`,
            output: "x".repeat(160)
          }
        })),
        {
          type: "response_item",
          timestamp: "2026-07-22T10:02:00.000Z",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Latest answer" }]
          }
        }
      ])}\n`,
      "utf8"
    );
    const afterAppend = await getCodexTranscriptTailWindow("session-source-window", {
      chatMessageTail: 2,
      force: true
    });
    assert.equal(
      afterAppend?.find((entry) => entry.text === "Recent answer")?.id,
      recentAnswerId
    );
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    daemonConfig.databaseFilePath = originalDatabaseFilePath;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("keeps a dense live Codex source window continuous beyond the legacy update limit", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-dense-live-window.jsonl");
  const largeToolOutput = "x".repeat(768 * 1024);
  const appendedToolEvents = Array.from({ length: 9_240 }, (_, index) => ({
    type: "response_item",
    timestamp: `2026-07-22T10:01:${String(index % 60).padStart(2, "0")}.000Z`,
    payload: {
      type: "function_call_output",
      call_id: `dense-${index}`,
      output: `dense tool result ${index}`
    }
  }));

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-dense-live-window",
      thread_name: "Dense live window",
      updated_at: "2026-07-22T10:00:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    `${jsonl([
      {
        type: "session_meta",
        payload: { id: "session-dense-live-window", cwd: "D:\\work\\repo" }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:01.000Z",
        payload: { type: "function_call_output", call_id: "initial", output: largeToolOutput }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:02.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Stable live cursor" }]
        }
      }
    ])}\n`,
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    const initial = await getCodexTranscriptTailWindow("session-dense-live-window", { force: true });
    const baseEntryId = initial?.find((entry) => entry.text === "Stable live cursor")?.id;
    assert.ok(baseEntryId);

    await appendFile(sessionFilePath, `${jsonl(appendedToolEvents)}\n`, "utf8");

    const windowEntries = await getCodexTranscriptWindow(
      "session-dense-live-window",
      baseEntryId,
      { maxLineCount: 16_384, overlapLineCount: 0, force: true }
    );

    assert.equal(windowEntries?.some((entry) => entry.id === baseEntryId), true);
    assert.equal(
      windowEntries?.some((entry) => entry.text === "9240 tool entries hidden in live view"),
      true
    );
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("serializes durable Codex line index writes across concurrent readers", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const originalDatabaseFilePath = daemonConfig.databaseFilePath;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const databaseFilePath = path.join(tempDir, "data", "deskcue.sqlite");
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionCount = 8;
  const sessionIds = Array.from(
    { length: sessionCount },
    (_, index) => `session-concurrent-index-${index + 1}`
  );

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    jsonl(sessionIds.map((id, index) => ({
      id,
      thread_name: `Concurrent index ${index + 1}`,
      updated_at: `2026-07-22T10:00:${String(index).padStart(2, "0")}.000Z`
    }))),
    "utf8"
  );

  for (const [index, id] of sessionIds.entries()) {
    await writeFile(
      path.join(sessionsRoot, `${id}.jsonl`),
      `${jsonl([
        {
          type: "session_meta",
          payload: {
            id,
            cwd: "D:\\work\\repo"
          }
        },
        {
          type: "event_msg",
          timestamp: "2026-07-22T10:00:00.000Z",
          payload: {
            type: "user_message",
            message: `Prompt ${index}`
          }
        },
        {
          type: "response_item",
          timestamp: "2026-07-22T10:00:01.000Z",
          payload: {
            type: "function_call_output",
            call_id: `call-${index}`,
            output: `Tool output ${index}`
          }
        },
        {
          type: "event_msg",
          timestamp: "2026-07-22T10:00:02.000Z",
          payload: {
            type: "patch_apply_end",
            success: true,
            changes: {
              [`src/file-${index}.ts`]: {
                type: "update",
                unified_diff: [
                  `diff --git a/src/file-${index}.ts b/src/file-${index}.ts`,
                  `--- a/src/file-${index}.ts`,
                  `+++ b/src/file-${index}.ts`,
                  "@@ -1 +1 @@",
                  "-old",
                  "+new"
                ].join("\n")
              }
            }
          }
        },
        {
          type: "response_item",
          timestamp: "2026-07-22T10:00:03.000Z",
          payload: {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: `Answer ${index}`
              }
            ]
          }
        }
      ])}\n`,
      "utf8"
    );
  }

  daemonConfig.agentDataRoots.codexHome = tempDir;
  daemonConfig.databaseFilePath = databaseFilePath;
  try {
    const entries = await Promise.all(
      sessionIds.map((sessionId) =>
        getCodexTranscriptEntries(
          sessionId,
          [`${sessionId}-2`, `${sessionId}-3`],
          true
        )
      )
    );

    assert.equal(entries.every((items) => items.length === 2), true);

    const persistedIndex = JSON.parse(
      await readFile(
        path.join(path.dirname(databaseFilePath), "codex-transcript-line-counts.json"),
        "utf8"
      )
    ) as {
      snapshots: Array<{ filePath?: string }>;
      version?: number;
    };
    const persistedFilePaths = new Set(persistedIndex.snapshots.map((snapshot) => snapshot.filePath));

    assert.equal(persistedIndex.version, 6);
    for (const sessionId of sessionIds) {
      assert.equal(
        persistedFilePaths.has(path.join(sessionsRoot, `${sessionId}.jsonl`)),
        true
      );
    }
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    daemonConfig.databaseFilePath = originalDatabaseFilePath;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("caps indexed Codex chat tail reads for huge tool-heavy transcripts", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-capped.jsonl");
  const largeToolOutput = "x".repeat(17 * 1024 * 1024);

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-capped",
      thread_name: "Capped transcript",
      updated_at: "2026-07-22T10:00:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-capped",
          cwd: "D:\\work\\repo"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "Old prompt before huge tool output"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Old answer before huge tool output"
            }
          ]
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:02.000Z",
        payload: {
          type: "function_call_output",
          call_id: "call-heavy",
          output: largeToolOutput
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:03.000Z",
        payload: {
          type: "user_message",
          message: "Recent prompt after huge tool output"
        }
      }
    ]),
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    const detail = await getCodexSessionDetail("session-capped", true, undefined, 8);
    const texts = detail?.transcript.map((entry) => entry.text) ?? [];

    assert.equal(texts.includes("Recent prompt after huge tool output"), true);
    assert.equal(texts.includes("Old prompt before huge tool output"), false);
    assert.equal(texts.includes("Old answer before huge tool output"), false);
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("reads lightweight Codex tails with tail-relative entry ids", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-lightweight.jsonl");
  const largeToolOutput = "x".repeat(1024 * 1024);

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-lightweight",
      thread_name: "Lightweight transcript",
      updated_at: "2026-07-22T10:00:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-lightweight",
          cwd: "D:\\work\\repo"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:00.000Z",
        payload: {
          type: "function_call_output",
          call_id: "call-heavy",
          output: largeToolOutput
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:01.000Z",
        payload: {
          type: "user_message",
          message: "Recent prompt"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:02.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Recent answer"
            }
          ]
        }
      }
    ]),
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    const detail = await getCodexSessionDetail("session-lightweight", true, 2, undefined, {
      includeContextCompactionCount: false,
      lineIndexOffset: "tail-relative",
      readExpandedTailWhenMissingUser: false
    });

    assert.deepEqual(
      detail?.transcript.map((entry) => entry.id),
      ["session-lightweight-0", "session-lightweight-1"]
    );
    assert.deepEqual(
      detail?.transcript.map((entry) => entry.text),
      ["Recent prompt", "Recent answer"]
    );
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("reads selected Codex transcript entries through cached line byte offsets", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-offsets.jsonl");
  const fillerRecords = Array.from({ length: 600 }, (_item, index) => ({
    type: "turn_context",
    timestamp: `2026-07-22T10:01:${String(index % 60).padStart(2, "0")}.000Z`,
    payload: {
      model: `filler-${index}`
    }
  }));
  const records = [
    {
      type: "session_meta",
      payload: {
        id: "session-offsets",
        cwd: "D:\\work\\repo"
      }
    },
    {
      type: "event_msg",
      timestamp: "2026-07-22T10:00:00.000Z",
      payload: {
        type: "user_message",
        message: "Early prompt"
      }
    },
    ...fillerRecords,
    {
      type: "event_msg",
      timestamp: "2026-07-22T10:10:00.000Z",
      payload: {
        type: "user_message",
        message: "Late prompt"
      }
    },
    {
      type: "response_item",
      timestamp: "2026-07-22T10:10:01.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Late answer"
          }
        ]
      }
    }
  ];
  const latePromptIndex = records.length - 2;
  const lateAnswerIndex = records.length - 1;

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-offsets",
      thread_name: "Offset transcript",
      updated_at: "2026-07-22T10:10:01.000Z"
    }),
    "utf8"
  );
  await writeFile(sessionFilePath, jsonl(records), "utf8");

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    const entries = await getCodexTranscriptEntries(
      "session-offsets",
      [
        `session-offsets-${latePromptIndex}`,
        `session-offsets-${lateAnswerIndex}`
      ],
      true
    );

    assert.deepEqual(
      entries.map((entry) => entry.text),
      ["Late prompt", "Late answer"]
    );

    await appendFile(
      sessionFilePath,
      `\n${JSON.stringify({
        type: "event_msg",
        timestamp: "2026-07-22T10:10:02.000Z",
        payload: {
          type: "user_message",
          message: "Appended prompt"
        }
      })}`,
      "utf8"
    );

    const appendedEntries = await getCodexTranscriptEntries(
      "session-offsets",
      [`session-offsets-${records.length}`],
      true
    );

    assert.deepEqual(
      appendedEntries.map((entry) => entry.text),
      ["Appended prompt"]
    );
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("reads Codex runtime context from large transcripts without requiring tail context", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-runtime-context.jsonl");
  const largeToolOutput = "x".repeat(5 * 1024 * 1024);

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-runtime-context",
      thread_name: "Runtime context",
      updated_at: "2026-07-22T10:20:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-runtime-context",
          cwd: "D:\\work\\repo"
        }
      },
      {
        type: "turn_context",
        timestamp: "2026-07-22T10:00:00.000Z",
        payload: {
          approval_policy: "on-request",
          model: "gpt-5",
          sandbox_policy: {
            type: "workspace-write"
          }
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:10:02.000Z",
        payload: {
          type: "function_call_output",
          call_id: "call-heavy",
          output: largeToolOutput
        }
      }
    ]),
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    assert.deepEqual(await getCodexSessionRuntimeContext("session-runtime-context"), {
      approvalPolicy: "on-request",
      model: "gpt-5",
      sandboxMode: "workspace-write"
    });
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("updates lightweight exact Codex detail from append-only cache", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-append-cache.jsonl");

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-append-cache",
      thread_name: "Append cache transcript",
      updated_at: "2026-07-22T10:20:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    `${jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-append-cache",
          cwd: "D:\\work\\repo"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "Initial prompt"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Initial answer"
            }
          ]
        }
      }
    ])}\n`,
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    const initial = await getCodexSessionDetail("session-append-cache", false, undefined, 2, {
      includeContextCompactionCount: false,
      lineIndexOffset: "exact",
      readExpandedTailWhenMissingUser: false
    });
    assert.equal(readCodexSessionDetailReadMode(initial), "bounded-detail");

    const cachedInitial = await getCodexSessionDetail("session-append-cache", false, undefined, 2, {
      includeContextCompactionCount: false,
      lineIndexOffset: "exact",
      readExpandedTailWhenMissingUser: false
    });
    assert.equal(readCodexSessionDetailReadMode(cachedInitial), "append-cache");

    await appendFile(
      sessionFilePath,
      `${JSON.stringify({
        type: "event_msg",
        timestamp: "2026-07-22T10:00:02.000Z",
        payload: {
          type: "user_message",
          message: "Appended prompt"
        }
      })}\n`,
      "utf8"
    );

    const updated = await getCodexSessionDetail("session-append-cache", false, undefined, 2, {
      includeContextCompactionCount: false,
      lineIndexOffset: "exact",
      readExpandedTailWhenMissingUser: false
    });

    assert.equal(readCodexSessionDetailReadMode(updated), "append-cache");
    assert.deepEqual(
      updated?.transcript.map((entry) => entry.id),
      ["session-append-cache-2", "session-append-cache-3"]
    );
    assert.deepEqual(
      updated?.transcript.map((entry) => entry.text),
      ["Initial answer", "Appended prompt"]
    );
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("keeps lightweight Codex append cache compact for heavy appended activity", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-heavy-append-cache.jsonl");
  const heavyAppendOutput = `APPENDED_HEAVY_TOOL_START\n${"x".repeat(768 * 1024)}`;

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-heavy-append-cache",
      thread_name: "Heavy append cache transcript",
      updated_at: "2026-07-22T10:20:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    `${jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-heavy-append-cache",
          cwd: "D:\\work\\repo"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "Initial prompt"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-07-22T10:00:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Initial answer"
            }
          ]
        }
      }
    ])}\n`,
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    await getCodexSessionDetail("session-heavy-append-cache", false, undefined, 2, {
      includeContextCompactionCount: false,
      lineIndexOffset: "exact",
      readExpandedTailWhenMissingUser: false
    });

    await appendFile(
      sessionFilePath,
      `${JSON.stringify({
        type: "response_item",
        timestamp: "2026-07-22T10:00:02.000Z",
        payload: {
          type: "function_call_output",
          call_id: "call-heavy-append",
          output: heavyAppendOutput
        }
      })}\n`,
      "utf8"
    );

    const updated = await getCodexSessionDetail("session-heavy-append-cache", false, undefined, 2, {
      includeContextCompactionCount: false,
      lineIndexOffset: "exact",
      readExpandedTailWhenMissingUser: false
    });

    assert.equal(readCodexSessionDetailReadMode(updated), "append-cache");
    assert.equal(JSON.stringify(updated?.transcript).includes("APPENDED_HEAVY_TOOL_START"), false);
    assert.deepEqual(
      updated?.transcript.find((entry) => entry.isCompact)?.sourceEntryRanges,
      [
        {
          end: 3,
          prefix: "session-heavy-append-cache-",
          start: 3
        }
      ]
    );

    const exactEntries = await getCodexTranscriptEntries(
      "session-heavy-append-cache",
      ["session-heavy-append-cache-3"],
      true
    );
    const exactToolResult = exactEntries
      .flatMap((entry) => entry.parts ?? [])
      .find((part) => part.type === "tool_result");
    assert.equal(
      exactToolResult?.type === "tool_result" &&
        exactToolResult.text.includes("APPENDED_HEAVY_TOOL_START"),
      true
    );
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("falls back from append cache when Codex transcript is truncated", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-truncated.jsonl");

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-truncated",
      thread_name: "Truncated transcript",
      updated_at: "2026-07-22T10:20:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    `${jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-truncated",
          cwd: "D:\\work\\repo"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "Original prompt"
        }
      }
    ])}\n`,
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    await getCodexSessionDetail("session-truncated", false, undefined, 1, {
      includeContextCompactionCount: false,
      lineIndexOffset: "exact",
      readExpandedTailWhenMissingUser: false
    });
    await writeFile(
      sessionFilePath,
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          id: "session-truncated",
          cwd: "D:\\work\\repo"
        }
      })}\n`,
      "utf8"
    );

    const updated = await getCodexSessionDetail("session-truncated", false, undefined, 1, {
      includeContextCompactionCount: false,
      lineIndexOffset: "exact",
      readExpandedTailWhenMissingUser: false
    });

    assert.equal(readCodexSessionDetailReadMode(updated), "bounded-detail");
    assert.deepEqual(updated?.transcript, []);
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("falls back safely when Codex append ends with an incomplete line", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-partial-append.jsonl");

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-partial-append",
      thread_name: "Partial append transcript",
      updated_at: "2026-07-22T10:20:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    `${jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-partial-append",
          cwd: "D:\\work\\repo"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "Stable prompt"
        }
      }
    ])}\n`,
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    await getCodexSessionDetail("session-partial-append", false, undefined, 1, {
      includeContextCompactionCount: false,
      lineIndexOffset: "exact",
      readExpandedTailWhenMissingUser: false
    });
    await appendFile(
      sessionFilePath,
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-07-22T10:00:02.000Z",
        payload: {
          type: "user_message",
          message: "Incomplete prompt"
        }
      }).slice(0, -4),
      "utf8"
    );

    const updated = await getCodexSessionDetail("session-partial-append", false, undefined, 1, {
      includeContextCompactionCount: false,
      lineIndexOffset: "exact",
      readExpandedTailWhenMissingUser: false
    });

    assert.equal(readCodexSessionDetailReadMode(updated), "bounded-detail");
    assert.deepEqual(
      updated?.transcript.map((entry) => entry.text),
      ["Stable prompt"]
    );
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("falls back from append cache when Codex transcript is rewritten with the same size", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-same-size-rewrite.jsonl");
  const records = (message: string) =>
    `${jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-same-size-rewrite",
          cwd: "D:\\work\\repo"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message
        }
      }
    ])}\n`;

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-same-size-rewrite",
      thread_name: "Same size rewrite transcript",
      updated_at: "2026-07-22T10:20:00.000Z"
    }),
    "utf8"
  );
  await writeFile(sessionFilePath, records("Alpha"), "utf8");

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    const initial = await getCodexSessionDetail(
      "session-same-size-rewrite",
      false,
      undefined,
      1,
      {
        includeContextCompactionCount: false,
        lineIndexOffset: "exact",
        readExpandedTailWhenMissingUser: false
      }
    );
    assert.equal(initial?.transcript[0]?.text, "Alpha");
    assert.equal(
      Buffer.byteLength(records("Alpha"), "utf8"),
      Buffer.byteLength(records("Bravo"), "utf8")
    );

    await writeFile(sessionFilePath, records("Bravo"), "utf8");
    await utimes(
      sessionFilePath,
      new Date("2026-07-22T10:20:10.000Z"),
      new Date("2026-07-22T10:20:10.000Z")
    );

    const updated = await getCodexSessionDetail(
      "session-same-size-rewrite",
      false,
      undefined,
      1,
      {
        includeContextCompactionCount: false,
        lineIndexOffset: "exact",
        readExpandedTailWhenMissingUser: false
      }
    );

    assert.equal(readCodexSessionDetailReadMode(updated), "bounded-detail");
    assert.deepEqual(
      updated?.transcript.map((entry) => entry.text),
      ["Bravo"]
    );
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("dedupes duplicate Codex user messages across append cache boundaries", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-append-dedupe.jsonl");
  const userMessage = (timestamp: string) =>
    JSON.stringify({
      type: "event_msg",
      timestamp,
      payload: {
        type: "user_message",
        message: "Same prompt"
      }
    });

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-append-dedupe",
      thread_name: "Append dedupe transcript",
      updated_at: "2026-07-22T10:20:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    `${jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-append-dedupe",
          cwd: "D:\\work\\repo"
        }
      }
    ])}\n${userMessage("2026-07-22T10:00:00.000Z")}\n`,
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    await getCodexSessionDetail("session-append-dedupe", false, undefined, 10, {
      includeContextCompactionCount: false,
      lineIndexOffset: "exact",
      readExpandedTailWhenMissingUser: false
    });
    await appendFile(
      sessionFilePath,
      `${userMessage("2026-07-22T10:00:01.000Z")}\n`,
      "utf8"
    );

    const updated = await getCodexSessionDetail("session-append-dedupe", false, undefined, 10, {
      includeContextCompactionCount: false,
      lineIndexOffset: "exact",
      readExpandedTailWhenMissingUser: false
    });

    assert.equal(readCodexSessionDetailReadMode(updated), "append-cache");
    assert.deepEqual(
      updated?.transcript.map((entry) => entry.text),
      ["Same prompt"]
    );
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("falls back from append cache when appended Codex lines need prior turn context", async () => {
  const originalCodexHome = daemonConfig.agentDataRoots.codexHome;
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-codex-facade-"));
  const sessionsRoot = path.join(tempDir, "sessions", "2026", "07");
  const sessionIndexPath = path.join(tempDir, "session_index.jsonl");
  const sessionFilePath = path.join(sessionsRoot, "session-append-turn-context.jsonl");
  const turnContext = (model: string, timestamp: string) =>
    JSON.stringify({
      type: "turn_context",
      timestamp,
      payload: {
        model
      }
    });

  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    sessionIndexPath,
    JSON.stringify({
      id: "session-append-turn-context",
      thread_name: "Append turn context transcript",
      updated_at: "2026-07-22T10:20:00.000Z"
    }),
    "utf8"
  );
  await writeFile(
    sessionFilePath,
    `${jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-append-turn-context",
          cwd: "D:\\work\\repo"
        }
      },
      JSON.parse(turnContext("gpt-4", "2026-07-22T10:00:00.000Z")),
      {
        type: "event_msg",
        timestamp: "2026-07-22T10:00:03.000Z",
        payload: {
          type: "user_message",
          message: "Prompt"
        }
      }
    ])}\n`,
    "utf8"
  );

  daemonConfig.agentDataRoots.codexHome = tempDir;
  try {
    await getCodexSessionDetail("session-append-turn-context", false, undefined, 10, {
      includeContextCompactionCount: false,
      lineIndexOffset: "exact",
      readExpandedTailWhenMissingUser: false
    });
    await appendFile(
      sessionFilePath,
      `${turnContext("gpt-5", "2026-07-22T10:00:04.000Z")}\n`,
      "utf8"
    );

    const updated = await getCodexSessionDetail(
      "session-append-turn-context",
      false,
      undefined,
      10,
      {
        includeContextCompactionCount: false,
        lineIndexOffset: "exact",
        readExpandedTailWhenMissingUser: false
      }
    );

    assert.equal(readCodexSessionDetailReadMode(updated), "bounded-detail");
    assert.deepEqual(
      updated?.transcript.map((entry) => entry.text),
      ["Prompt", "Model changed to GPT-5"]
    );
  } finally {
    daemonConfig.agentDataRoots.codexHome = originalCodexHome;
    await rm(tempDir, { force: true, recursive: true });
  }
});
