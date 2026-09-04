import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseCodexTranscript,
  parseCodexTranscriptChatMessageTail,
  parseCodexTranscriptTail
} from "./codexTranscript.ts";
import {
  buildGeneratedImageToolResultParts,
  waitForGeneratedImageWritesForTests
} from "./entries/codexTranscriptGeneratedImages.ts";

function jsonl(records: Array<Record<string, unknown>>) {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

test("parses user and assistant messages", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "Ship it"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Done"
            }
          ]
        }
      }
    ]),
    "session-1"
  );

  assert.equal(transcript.length, 2);
  assert.equal(transcript[0]?.role, "user");
  assert.equal(transcript[0]?.text, "Ship it");
  assert.equal(transcript[1]?.role, "assistant");
  assert.equal(transcript[1]?.parts?.[0]?.type, "markdown");
});

test("preserves assistant-authored asset presentation without synthetic attachments", () => {
  const text = [
    "![Inline image](D:/evidence/screenshot.png)",
    "[Video link](D:/evidence/demo.mp4)",
    "[Report file](D:/evidence/report.pdf)"
  ].join("\n\n");
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-09-02T10:00:00.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }]
        }
      }
    ]),
    "session-authored-assets"
  );

  assert.deepEqual(transcript[0]?.parts, [{ type: "markdown", text }]);
});

test("preserves fenced code blocks in assistant messages", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Run it:\n\n```powershell\n# stop old watcher\nnpm run dev:watch\n```"
            }
          ]
        }
      }
    ]),
    "session-fence"
  );

  assert.equal(transcript.length, 1);
  assert.equal(transcript[0]?.role, "assistant");
  assert.equal(
    transcript[0]?.text,
    "Run it:\n\n```powershell\n# stop old watcher\nnpm run dev:watch\n```"
  );

  assert.equal(transcript[0]?.parts?.[0]?.type, "markdown");
  assert.equal(
    transcript[0]?.parts?.[0]?.type === "markdown" ? transcript[0].parts[0].text : "",
    "Run it:\n\n```powershell\n# stop old watcher\nnpm run dev:watch\n```"
  );
});

test("parses Codex task_complete overload as a failed turn", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "task_complete",
          duration_ms: 18_022,
          last_agent_message: JSON.stringify({
            message: "Selected model is at capacity. Please try a different model.",
            codex_error_info: "server_overloaded"
          })
        }
      }
    ]),
    "session-overloaded"
  );

  const statusPart = transcript[0]?.parts?.[0];

  assert.equal(transcript.length, 1);

  assert.equal(transcript[0]?.role, "system");
  assert.equal(transcript[0]?.text, "Selected model is at capacity. Please try a different model.");
  assert.equal(statusPart?.type, "status");
  assert.equal(statusPart?.type === "status" ? statusPart.label : null, "Turn failed");
  assert.equal(
    statusPart?.type === "status" ? statusPart.detail : null,
    "Selected model is at capacity. Please try a different model. after 18s"
  );
});

test("strips injected Codex context from user messages", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "AGENTS.md instructions for /workspace/project",
                "<INSTRUCTIONS>",
                "Internal workspace instructions",
                "</INSTRUCTIONS>",
                "<environment_context>",
                "<cwd>/workspace/project</cwd>",
                "<sandbox_mode>danger-full-access</sandbox_mode>",
                "</environment_context>",
                "",
                "Test prompt"
              ].join("\n")
            }
          ]
        }
      }
    ]),
    "session-context"
  );

  assert.equal(transcript.length, 1);
  assert.equal(transcript[0]?.role, "user");
  assert.equal(transcript[0]?.text, "Test prompt");
  const firstPart = transcript[0]?.parts?.[0];

  assert.equal(firstPart?.type, "markdown");

  assert.equal(firstPart?.type === "markdown" ? firstPart.text : "", "Test prompt");
});

test("unwraps delegated external prompts instead of rendering their transport envelope", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-07-30T10:00:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "<codex_delegation>",
                "<source_thread_id>thread-1</source_thread_id>",
                "<input>Check the current task without changing files.</input>",
                "</codex_delegation>"
              ].join("\n")
            }
          ]
        }
      }
    ]),
    "session-delegation"
  );

  assert.equal(transcript.length, 1);
  assert.equal(transcript[0]?.text, "Check the current task without changing files.");
  assert.equal(transcript[0]?.origin, "external");
});

test("strips single-line injected Codex instruction tags from user messages", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "AGENTS.md instructions for /workspace/project",
                "<INSTRUCTIONS> These AGENTS.md instructions replace all previously provided AGENTS.md instructions.",
                "Internal workspace instructions",
                "</INSTRUCTIONS>",
                "<environment_context>",
                "<cwd>/workspace/project</cwd>",
                "</environment_context>",
                "",
                "Test prompt"
              ].join("\n")
            }
          ]
        }
      }
    ]),
    "session-single-line-context"
  );

  assert.equal(transcript.length, 1);
  assert.equal(transcript[0]?.role, "user");
  assert.equal(transcript[0]?.text, "Test prompt");
});

test("strips recommended plugins and injected workspace context from user messages", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "<recommended_plugins>",
                "Here is a list of plugins that are available but not installed.",
                "</recommended_plugins>",
                "# AGENTS.md instructions for /workspace/project",
                "<INSTRUCTIONS>",
                "Internal workspace instructions",
                "</INSTRUCTIONS>",
                "<environment_context>",
                "<cwd>/workspace/project</cwd>",
                "<shell>powershell</shell>",
                "</environment_context>",
                "",
                "Real prompt"
              ].join("\n")
            }
          ]
        }
      }
    ]),
    "session-recommended-plugins-context"
  );

  assert.equal(transcript.length, 1);
  assert.equal(transcript[0]?.role, "user");
  assert.equal(transcript[0]?.text, "Real prompt");
});

test("renders response annotations without the Codex transport instructions", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-09-03T10:00:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "# Response annotations:",
                "Each item contains text selected from an earlier Codex response.",
                "Use every selection as context and address every comment.",
                "<response-annotations>",
                JSON.stringify([
                  { text: "Selected first line\nand second line", annotation: "Please revisit this" },
                  { text: "Another selection", annotation: "" }
                ]),
                "</response-annotations>",
                "",
                "## My request:",
                "Fix the actions"
              ].join("\n")
            }
          ]
        }
      }
    ]),
    "session-response-annotations"
  );

  const expectedText = [
    "Fix the actions",
    "",
    "### Response annotations",
    "",
    "**Annotation 1**",
    "",
    "> Selected first line",
    "> and second line",
    "",
    "**Comment:** Please revisit this",
    "",
    "**Annotation 2**",
    "",
    "> Another selection"
  ].join("\n");

  assert.equal(transcript[0]?.text, expectedText);
  assert.equal(transcript[0]?.parts?.[0]?.type, "markdown");
  assert.equal(
    transcript[0]?.parts?.[0]?.type === "markdown" ? transcript[0].parts[0].text : "",
    expectedText
  );
});

test("leaves a malformed response annotation envelope visible", () => {
  const rawText = [
    "# Response annotations:",
    "Each item contains text selected from an earlier Codex response.",
    "Use every selection as context and address every comment.",
    "<response-annotations>",
    "[{malformed]",
    "</response-annotations>",
    "## My request:",
    "Keep this visible"
  ].join("\n");
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-09-03T10:00:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: rawText }]
        }
      }
    ]),
    "session-malformed-response-annotations"
  );

  assert.equal(transcript[0]?.text, rawText);
});

test("removes response annotation placement directives from assistant messages", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-09-03T10:00:00.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{
            type: "output_text",
            text: "Handled the first item. :codex-annotation{index=\"1\"}"
          }]
        }
      }
    ]),
    "session-response-annotation-directive"
  );

  assert.equal(transcript[0]?.text, "Handled the first item.");
});

test("preserves response annotation syntax inside assistant code", () => {
  const text = [
    "Literal `:codex-annotation{index=1}` token",
    "",
    "```text",
    ":codex-annotation{index=\"2\"}",
    "```",
    "",
    "Handled. :codex-annotation{index=\"3\"}"
  ].join("\n");
  const transcript = parseCodexTranscript(
    jsonl([{
      type: "response_item",
      timestamp: "2026-09-03T10:00:00.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }]
      }
    }]),
    "session-response-annotation-code"
  );

  assert.equal(transcript[0]?.text, [
    "Literal `:codex-annotation{index=1}` token",
    "",
    "```text",
    ":codex-annotation{index=\"2\"}",
    "```",
    "",
    "Handled."
  ].join("\n"));
});

test("preserves response annotation syntax in nested and indented code", () => {
  const text = [
    "Code examples:",
    "",
    "    :codex-annotation{index=1}",
    "",
    "> ```text",
    "> Example :codex-annotation{index=2}",
    "> ```not-a-closer",
    "> :codex-annotation{index=3}",
    "> ```",
    "",
    "Handled. :codex-annotation{index=4}"
  ].join("\n");
  const transcript = parseCodexTranscript(
    jsonl([{
      type: "response_item",
      timestamp: "2026-09-03T10:00:00.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }]
      }
    }]),
    "session-response-annotation-nested-code"
  );

  assert.equal(transcript[0]?.text, text.replace(
    "Handled. :codex-annotation{index=4}",
    "Handled."
  ));
});

test("removes standalone response annotation directives outside code", () => {
  const text = [
    "Handled",
    ":codex-annotation{index=1}",
    "Done"
  ].join("\n");
  const transcript = parseCodexTranscript(
    jsonl([{
      type: "response_item",
      timestamp: "2026-09-03T10:00:00.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }]
      }
    }]),
    "session-response-annotation-standalone"
  );

  assert.equal(transcript[0]?.text, "Handled\n\nDone");
});

test("removes response annotation directives with empty Markdown containers", () => {
  const text = [
    "Before",
    "- :codex-annotation{index=1}",
    "> :codex-annotation{index=2}",
    "# :codex-annotation{index=3}",
    "1. :codex-annotation{index=4}",
    "After"
  ].join("\n");
  const transcript = parseCodexTranscript(
    jsonl([{
      type: "response_item",
      timestamp: "2026-09-03T10:00:00.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }]
      }
    }]),
    "session-response-annotation-empty-containers"
  );

  assert.equal(transcript[0]?.text, "Before\n\nAfter");
});

test("preserves response annotation syntax in a list-item code fence", () => {
  const text = [
    "- ```text",
    "  inside :codex-annotation{index=1}",
    "  ```",
    "",
    "Handled :codex-annotation{index=2}"
  ].join("\n");
  const transcript = parseCodexTranscript(
    jsonl([{
      type: "response_item",
      timestamp: "2026-09-03T10:00:00.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }]
      }
    }]),
    "session-response-annotation-list-fence"
  );

  assert.equal(transcript[0]?.text, text.replace(
    "Handled :codex-annotation{index=2}",
    "Handled"
  ));
});

test("removes directives after an implicitly closed blockquote fence", () => {
  const text = [
    "> ```text",
    "> inside :codex-annotation{index=1}",
    "",
    "Handled :codex-annotation{index=2}"
  ].join("\n");
  const transcript = parseCodexTranscript(
    jsonl([{
      type: "response_item",
      timestamp: "2026-09-03T10:00:00.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }]
      }
    }]),
    "session-response-annotation-implicit-close"
  );

  assert.equal(transcript[0]?.text, text.replace(
    "Handled :codex-annotation{index=2}",
    "Handled"
  ));
});

test("escapes Markdown authored inside response annotations", () => {
  const transcript = parseCodexTranscript(
    jsonl([{
      type: "response_item",
      timestamp: "2026-09-03T10:00:00.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: [
            "# Response annotations:",
            "Each item contains text selected from an earlier Codex response.",
            "Use every selection as context and address every comment.",
            "<response-annotations>",
            JSON.stringify([{
              text: "# Heading\n![asset](javascript:alert(1))",
              annotation: "Use **literal** syntax"
            }]),
            "</response-annotations>",
            "## My request:",
            "Review this"
          ].join("\n")
        }]
      }
    }]),
    "session-response-annotation-markdown"
  );

  assert.equal(transcript[0]?.text, [
    "Review this",
    "",
    "### Response annotations",
    "",
    "**Annotation 1**",
    "",
    "> \\# Heading",
    "> \\!\\[asset\\]\\(javascript:alert\\(1\\)\\)",
    "",
    "**Comment:** Use \\*\\*literal\\*\\* syntax"
  ].join("\n"));
});

test("keeps mixed-invalid and literal response annotation documents visible", () => {
  const preamble = [
    "# Response annotations:",
    "Each item contains text selected from an earlier Codex response.",
    "Use every selection as context and address every comment."
  ];
  const mixedInvalid = [
    ...preamble,
    "<response-annotations>",
    JSON.stringify([{ text: "Valid", annotation: "Comment" }, { text: 42 }]),
    "</response-annotations>",
    "## My request:",
    "Keep everything"
  ].join("\n");
  const literalDocument = [
    "# Response annotations:",
    "This is a literal format example.",
    "<response-annotations>",
    JSON.stringify([{ text: "Example", annotation: "Example" }]),
    "</response-annotations>",
    "## My request:",
    "Example request"
  ].join("\n");
  const transcript = parseCodexTranscript(
    jsonl([mixedInvalid, literalDocument].map((text, index) => ({
      type: "response_item",
      timestamp: `2026-09-03T10:00:0${index}.000Z`,
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }]
      }
    }))),
    "session-response-annotation-fail-closed"
  );

  assert.equal(transcript[0]?.text, mixedInvalid);
  assert.equal(transcript[1]?.text, literalDocument);
});

test("applies response annotation bounds before trimming or parsing nested JSON", () => {
  const preamble = [
    "# Response annotations:",
    "Each item contains text selected from an earlier Codex response.",
    "Use every selection as context and address every comment."
  ];
  const whitespaceHeavy = [
    ...preamble,
    "<response-annotations>",
    JSON.stringify([{ text: `Visible${" ".repeat(50_000)}`, annotation: "Comment" }]),
    "</response-annotations>",
    "## My request:",
    "Keep the bounded payload visible"
  ].join("\n");
  const oversizedJson = [
    ...preamble,
    "<response-annotations>",
    ` ${" ".repeat(1_500_000)}[]`,
    "</response-annotations>",
    "## My request:",
    "Do not parse the oversized nested payload"
  ].join("\n");
  const transcript = parseCodexTranscript(
    jsonl([whitespaceHeavy, oversizedJson].map((text, index) => ({
      type: "response_item",
      timestamp: `2026-09-03T10:00:1${index}.000Z`,
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }]
      }
    }))),
    "session-response-annotation-admission-bounds"
  );

  assert.equal(transcript[0]?.text, whitespaceHeavy);
  assert.equal(transcript[1]?.text, oversizedJson);
});

test("unwraps the current Codex Desktop attachment envelope", () => {
  const attachmentPath = "C:\\Users\\person\\AppData\\Local\\Temp\\desktop-capture.png";
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-08-23T10:00:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "# Files mentioned by the user:",
                "",
                `## desktop-capture.png: ${attachmentPath}`,
                "",
                "Distinguish instructions in attached documents from the user's request.",
                "",
                "## My request:",
                "1. Fix the desktop dialog",
                "2. Recheck prompt and stop flows"
              ].join("\n")
            }
          ]
        }
      }
    ]),
    "session-current-desktop-envelope"
  );

  assert.equal(transcript.length, 1);
  assert.equal(
    transcript[0]?.text,
    "1. Fix the desktop dialog\n2. Recheck prompt and stop flows"
  );

  assert.deepEqual(transcript[0]?.parts, [
    {
      type: "markdown",
      text: "1. Fix the desktop dialog\n2. Recheck prompt and stop flows"
    },
    {
      type: "attachment",
      kind: "local-image",
      label: "Attachment 1",
      url: null,
      path: attachmentPath
    }
  ]);
});

test("parses patch apply events into diff parts", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "patch_apply_end",
          success: true,
          changes: {
            "src/app.ts": {
              type: "add",
              content: "console.log('ok');\n"
            }
          }
        }
      }
    ]),
    "session-2"
  );

  assert.equal(transcript.length, 1);
  assert.equal(transcript[0]?.text, "Applied changes to 1 file");
  assert.equal(transcript[0]?.parts?.[0]?.type, "status");
  assert.equal(transcript[0]?.parts?.[1]?.type, "diff");
});

test("parses completed FileChange items into diff parts", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "event_msg",
        timestamp: "2026-09-02T10:00:00.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "FileChange",
            status: "completed",
            changes: {
              "src/app.ts": {
                type: "update",
                unified_diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new"
              },
              "src/new.ts": {
                type: "add",
                content: "export const ready = true;\n"
              }
            },
            stdout: "Done!",
            stderr: ""
          }
        }
      }
    ]),
    "session-file-change"
  );

  assert.equal(transcript.length, 1);
  assert.equal(transcript[0]?.text, "Applied changes to 2 files");
  assert.deepEqual(
    transcript[0]?.parts?.map((part) => part.type),
    ["status", "diff", "diff"]
  );
});

test("maps failed FileChange items to failed patch status", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "event_msg",
        timestamp: "2026-09-02T10:00:00.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "FileChange",
            status: "failed",
            changes: {
              "src/app.ts": {
                type: "update",
                unified_diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new"
              }
            },
            stderr: "Patch rejected"
          }
        }
      }
    ]),
    "session-file-change-failed"
  );

  const status = transcript[0]?.parts?.[0];

  assert.equal(transcript.length, 1);
  assert.equal(transcript[0]?.text, "Patch failed after editing 1 file");
  assert.equal(status?.type, "status");
  assert.equal(status?.type === "status" ? status.label : null, "Patch failed");
});

test("treats missing FileChange status as non-failed completion", () => {
  const transcript = parseCodexTranscript(
    jsonl([{
      type: "event_msg",
      timestamp: "2026-09-02T10:00:00.000Z",
      payload: {
        type: "item_completed",
        item: {
          type: "FileChange",
          changes: {
            "src/app.ts": {
              type: "update",
              unified_diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new"
            }
          }
        }
      }
    }]),
    "session-file-change-missing-status"
  );

  assert.equal(transcript[0]?.text, "Applied changes to 1 file");
});

test("preserves adjacent equivalent legacy and FileChange patch events", () => {
  const changes = {
    "src/app.ts": {
      type: "update",
      unified_diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new"
    }
  };

  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "event_msg",
        timestamp: "2026-09-02T10:00:00.000Z",
        payload: {
          type: "patch_apply_end",
          success: true,
          changes
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-09-02T10:00:01.000Z",
        payload: {
          type: "item_completed",
          item: {
            type: "FileChange",
            status: "completed",
            changes
          }
        }
      }
    ]),
    "session-dual-patch-events"
  );

  assert.equal(transcript.length, 2);
  assert.equal(
    transcript.flatMap((entry) => entry.parts ?? []).filter((part) => part.type === "diff").length,
    2
  );
});

test("preserves two identical modern FileChange events as distinct source entries", () => {
  const event = {
    type: "event_msg",
    timestamp: "2026-09-02T10:00:00.000Z",
    payload: {
      type: "item_completed",
      item: {
        type: "FileChange",
        status: "completed",
        changes: {
          "src/app.ts": {
            type: "update",
            unified_diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new"
          }
        }
      }
    }
  };

  const transcript = parseCodexTranscript(
    jsonl([event, { ...event, timestamp: "2026-09-02T10:00:01.000Z" }]),
    "session-two-modern-file-changes"
  );

  assert.equal(transcript.length, 2);
  assert.notEqual(transcript[0]?.id, transcript[1]?.id);
});

test("keeps tool call arguments out of summary text and redacts secrets", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "function_call",
          name: "shell_command",
          arguments: JSON.stringify({
            command: "curl http://127.0.0.1:4100/api/overview?token=dcd_secret-token",
            authorization: "Bearer secret-access-token"
          })
        }
      }
    ]),
    "session-tool-call"
  );

  const entry = transcript[0];
  const part = entry?.parts?.[0];

  assert.equal(entry?.text, "Called shell_command");
  assert.equal(part?.type, "tool_call");
  assert.equal(part.type === "tool_call" && part.argumentsText?.includes("dcd_secret-token"), false);
  assert.equal(part.type === "tool_call" && part.argumentsText?.includes("secret-access-token"), false);
  assert.equal(part.type === "tool_call" && part.argumentsText?.includes("[redacted"), true);
  assert.equal(part.type === "tool_call" && part.argumentsText?.includes("\"authorization\":\"[redacted]\""), true);
});

test("redacts tool call secrets near the preview boundary", () => {
  const secret = `Bearer ${"a".repeat(80)}`;
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "function_call",
          name: "shell_command",
          arguments: `${"x".repeat(260)} authorization: ${secret} ${"y".repeat(1000)}`
        }
      }
    ]),
    "session-tool-preview-redaction"
  );

  const part = transcript[0]?.parts?.[0];

  assert.equal(part?.type, "tool_call");
  assert.equal(part.type === "tool_call" && part.argumentsText?.includes(secret), false);
  assert.equal(part.type === "tool_call" && part.argumentsText?.includes("Bearer [redacted]"), true);
  assert.equal(part.type === "tool_call" && (part.argumentsText?.length ?? 0) <= 323, true);
});

test("parses custom tool calls and outputs", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "custom_tool_call",
          name: "apply_patch",
          input: "*** Begin Patch\n*** End Patch"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:01.000Z",
        payload: {
          type: "custom_tool_call_output",
          output: "Success. Updated the following files:\nM apps/web/src/app.ts"
        }
      }
    ]),
    "session-custom-tool"
  );

  assert.equal(transcript.length, 2);
  assert.equal(transcript[0]?.text, "Called apply_patch");
  assert.equal(transcript[0]?.parts?.[0]?.type, "tool_call");
  assert.equal(transcript[1]?.text, "Tool completed");
  assert.equal(transcript[1]?.parts?.[0]?.type, "tool_result");
});

test("redacts secrets from tool outputs", () => {
  const telegramTokenFixture = ["8827596817", "AAGiASaEn-EPkQk8V-mZM55lKsmKptNimD8"].join(":");
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "function_call_output",
          output: `Telegram token ${telegramTokenFixture}`
        }
      }
    ]),
    "session-tool-output"
  );

  const part = transcript[0]?.parts?.[0];

  assert.equal(part?.type, "tool_result");
  assert.equal(part.type === "tool_result" && part.text.includes("8827596817"), false);
  assert.equal(part.type === "tool_result" && part.text.includes("[redacted telegram token]"), true);
});

test("preserves attachments and context compacted status", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "Review screenshot",
          local_images: ["C:/tmp/screen.png"]
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:01.000Z",
        payload: {
          type: "compacted",
          replacement_history: [
            {
              id: "old-message"
            }
          ]
        }
      }
    ]),
    "session-3"
  );

  assert.equal(transcript.length, 2);
  assert.equal(transcript[0]?.parts?.some((part) => part.type === "attachment"), true);
  assert.equal(transcript[1]?.phase, "context_compacted");
  assert.equal(transcript[1]?.parts?.[0]?.type, "status");
});

test("materializes model changes from turn context transitions", () => {
  const transcript = parseCodexTranscript(
    jsonl([
      {
        type: "turn_context",
        timestamp: "2026-06-22T10:00:00.000Z",
        model: "gpt-5.6-terra"
      },
      {
        type: "turn_context",
        timestamp: "2026-06-22T10:00:01.000Z",
        model: "gpt-5.5"
      }
    ]),
    "session-model-change"
  );

  assert.equal(transcript.length, 1);
  assert.equal(transcript[0]?.phase, "model_changed");
  assert.equal(transcript[0]?.text, "Model changed to GPT-5.5");
  assert.equal(transcript[0]?.parts?.[0]?.type, "status");
});

test("materializes generated image tool outputs as transcript attachments asynchronously", async () => {
  const previousCodexHome = process.env.CODEX_HOME;
  const codexHome = mkdtempSync(path.join(os.tmpdir(), "deskcue-codex-home-"));

  process.env.CODEX_HOME = codexHome;

  try {
    const pngBytes = Buffer.from("deskcue-test-image");
    const transcript = parseCodexTranscript(
      jsonl([
        {
          type: "response_item",
          timestamp: "2026-06-22T10:00:00.000Z",
          payload: {
            type: "function_call_output",
            call_id: "call_image_1",
            output: [
              {
                type: "input_image",
                image_url: `data:image/png;base64,${pngBytes.toString("base64")}`
              },
              {
                type: "input_text",
                text: "Generated images are saved to the default path."
              }
            ]
          }
        }
      ]),
      "session-image"
    );

    const attachment = transcript[0]?.parts?.find((part) => part.type === "attachment");
    const toolResult = transcript[0]?.parts?.find((part) => part.type === "tool_result");

    assert.equal(transcript[0]?.text, "Generated image");
    assert.equal(attachment?.type, "attachment");
    assert.equal(attachment?.kind, "local-image");
    assert.equal(attachment?.label, "Generated image");
    assert.ok(attachment?.path);
    await waitForGeneratedImageWritesForTests();
    assert.equal(existsSync(attachment.path), true);
    assert.equal(readFileSync(attachment.path).toString(), "deskcue-test-image");
    assert.equal(toolResult?.type, "tool_result");
    assert.equal(toolResult?.text, "Generated images are saved to the default path.");
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }

    rmSync(codexHome, { force: true, recursive: true });
  }
});

test("bounds retained generated transcript images per session", async () => {
  const previousCodexHome = process.env.CODEX_HOME;
  const codexHome = mkdtempSync(path.join(os.tmpdir(), "deskcue-codex-home-"));

  process.env.CODEX_HOME = codexHome;

  try {
    let lastImagePath = "";

    for (let index = 0; index < 33; index += 1) {
      const parts = buildGeneratedImageToolResultParts([
        {
          type: "input_image",
          image_url: `data:image/png;base64,${Buffer.from(`image-${index}`).toString("base64")}`
        }
      ], "bounded-session", `call-${index}`);

      lastImagePath = parts[0]?.type === "attachment" ? parts[0].path ?? "" : "";
      await waitForGeneratedImageWritesForTests();
    }

    assert.ok(lastImagePath);
    assert.equal(readdirSync(path.dirname(lastImagePath)).length, 32);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }

    rmSync(codexHome, { force: true, recursive: true });
  }
});

test("parses transcript tail while retaining earlier context compaction markers", () => {
  const transcript = parseCodexTranscriptTail(
    jsonl([
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "compacted",
          replacement_history: []
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:01.000Z",
        payload: {
          type: "user_message",
          message: "old prompt"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:02.000Z",
        payload: {
          type: "user_message",
          message: "latest prompt"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:03.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "latest answer"
            }
          ]
        }
      }
    ]),
    "session-4",
    2
  );

  assert.deepEqual(
    transcript.map((entry) => entry.text),
    ["Context compressed", "old prompt", "latest prompt", "latest answer"]
  );

  assert.equal(transcript[0]?.phase, "context_compacted");
});

test("parses transcript tail while retaining spaced context compaction markers", () => {
  const transcript = parseCodexTranscriptTail(
    [
      JSON.stringify(
        {
          type: "response_item",
          timestamp: "2026-06-22T10:00:00.000Z",
          payload: {
            type: "compacted",
            replacement_history: []
          }
        },
        null,
        0
      ).replace('"type":"compacted"', '"type": "compacted"'),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-06-22T10:00:01.000Z",
        payload: {
          type: "user_message",
          message: "latest prompt"
        }
      })
    ].join("\n"),
    "session-4-spaced",
    1
  );

  assert.equal(transcript[0]?.phase, "context_compacted");
  assert.equal(transcript[1]?.text, "latest prompt");
});

test("parses chat message tail without detached earlier model changes", () => {
  const transcript = parseCodexTranscriptChatMessageTail(
    jsonl([
      {
        type: "turn_context",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          model: "gpt-5.6-terra"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:01.000Z",
        payload: {
          type: "user_message",
          message: "old prompt"
        }
      },
      {
        type: "turn_context",
        timestamp: "2026-06-22T10:00:02.000Z",
        payload: {
          model: "gpt-5.5"
        }
      },
      ...Array.from({ length: 20 }, (_, index) => ({
        type: index % 2 === 0 ? "event_msg" : "response_item",
        timestamp: `2026-06-22T10:01:${String(index).padStart(2, "0")}.000Z`,
        payload:
          index % 2 === 0
            ? {
                type: "user_message",
                message: `prompt ${index}`
              }
            : {
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: `answer ${index}`
                  }
                ]
              }
      }))
    ]),
    "session-model-tail",
    2
  );

  assert.equal(
    transcript.some((entry) => entry.phase === "model_changed" && entry.text === "Model changed to GPT-5.5"),
    false
  );

  assert.equal(
    transcript.some((entry) => entry.role === "user" && entry.text === "old prompt"),
    false
  );
});

test("parses chat message tail while retaining model changes inside the visible window", () => {
  const transcript = parseCodexTranscriptChatMessageTail(
    jsonl([
      {
        type: "turn_context",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          model: "gpt-5.6-terra"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:01.000Z",
        payload: {
          type: "user_message",
          message: "old prompt"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:02.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "old answer"
            }
          ]
        }
      },
      {
        type: "turn_context",
        timestamp: "2026-06-22T10:00:03.000Z",
        payload: {
          model: "gpt-5.5"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:04.000Z",
        payload: {
          type: "user_message",
          message: "latest prompt"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:05.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "latest answer"
            }
          ]
        }
      }
    ]),
    "session-model-visible-tail",
    3
  );

  assert.equal(
    transcript.some((entry) => entry.phase === "model_changed" && entry.text === "Model changed to GPT-5.5"),
    true
  );

  assert.equal(
    transcript.some((entry) => entry.role === "user" && entry.text === "old prompt"),
    false
  );
});

test("parses transcript tail while retaining recent chat messages before tool-heavy tail", () => {
  const toolEvents = Array.from({ length: 8 }, (_, index) => ({
    type: "response_item",
    timestamp: `2026-06-22T10:00:${String(index + 3).padStart(2, "0")}.000Z`,
    payload: {
      type: "function_call_output",
      call_id: `call-${index}`,
      output: `tool ${index}`
    }
  }));

  const transcript = parseCodexTranscriptTail(
    jsonl([
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "older visible prompt"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "older visible answer"
            }
          ]
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:02.000Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [
            {
              type: "output_text",
              text: "thinking detail"
            }
          ]
        }
      },
      ...toolEvents
    ]),
    "session-5",
    3
  );

  assert.equal(
    transcript.some((entry) => entry.role === "user" && entry.text === "older visible prompt"),
    true
  );

  assert.equal(
    transcript.some((entry) => entry.role === "assistant" && entry.text === "older visible answer"),
    true
  );

  assert.equal(
    transcript.some((entry) => entry.role === "commentary" && entry.text === "thinking detail"),
    false
  );
});

test("parses transcript tail with a broad recent chat message floor", () => {
  const chatRecords = Array.from({ length: 120 }, (_, index) => ({
    type: index % 2 === 0 ? "event_msg" : "response_item",
    timestamp: `2026-06-22T10:${String(Math.floor(index / 2)).padStart(2, "0")}:00.000Z`,
    payload:
      index % 2 === 0
        ? {
            type: "user_message",
            message: `prompt ${index}`
          }
        : {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: `answer ${index}`
              }
            ]
          }
  }));
  const toolRecords = Array.from({ length: 20 }, (_, index) => ({
    type: "response_item",
    timestamp: `2026-06-22T12:00:${String(index).padStart(2, "0")}.000Z`,
    payload: {
      type: "function_call_output",
      call_id: `call-${index}`,
      output: `tool ${index}`
    }
  }));

  const transcript = parseCodexTranscriptTail(
    jsonl([...chatRecords, ...toolRecords]),
    "session-6",
    5
  );
  const chatEntries = transcript.filter(
    (entry) => entry.role === "user" || entry.role === "assistant"
  );

  assert.equal(chatEntries.length, 120);
  assert.equal(chatEntries[0]?.text, "prompt 0");
  assert.equal(chatEntries.at(-1)?.text, "answer 119");
});

test("parses transcript tail with the latest turn lifecycle marker before a tool-heavy tail", () => {
  const records = [
    {
      type: "event_msg",
      timestamp: "2026-06-22T10:00:00.000Z",
      payload: {
        type: "task_started"
      }
    },
    ...Array.from({ length: 20 }, (_, index) => ({
      type: "response_item",
      timestamp: `2026-06-22T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
      payload: {
        type: "function_call_output",
        call_id: `call-${index}`,
        output: `tool ${index}`
      }
    }))
  ];

  const transcript = parseCodexTranscriptTail(jsonl(records), "session-7", 5);

  assert.equal(
    transcript.some(
      (entry) =>
        entry.role === "system" &&
        entry.parts?.some((part) => part.type === "status" && part.label === "Turn started")
    ),
    true
  );
});

test("parses chat message tail by user and assistant messages instead of raw event count", () => {
  const detailEvents = Array.from({ length: 10 }, (_, index) => ({
    type: "response_item",
    timestamp: `2026-06-22T10:00:${String(index + 3).padStart(2, "0")}.000Z`,
    payload: {
      type: "message",
      role: "assistant",
      phase: "commentary",
      content: [
        {
          type: "output_text",
          text: `detail ${index}`
        }
      ]
    }
  }));

  const transcript = parseCodexTranscriptChatMessageTail(
    jsonl([
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "old prompt"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "old answer"
            }
          ]
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:02.000Z",
        payload: {
          type: "user_message",
          message: "latest prompt"
        }
      },
      ...detailEvents,
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:20.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "latest answer"
            }
          ]
        }
      }
    ]),
    "session-chat-tail",
    2
  );

  const chatEntries = transcript.filter(
    (entry) => entry.role === "user" || entry.role === "assistant"
  );

  assert.deepEqual(
    chatEntries.map((entry) => entry.text),
    ["latest prompt", "latest answer"]
  );

  assert.equal(
    transcript.some((entry) => entry.role === "commentary" && entry.text.includes("detail 0")),
    true
  );

  assert.equal(
    transcript.some((entry) => entry.text === "old prompt" || entry.text === "old answer"),
    false
  );
});

test("keeps original line indexes for transcript tails with a file offset", () => {
  const transcript = parseCodexTranscriptChatMessageTail(
    jsonl([
      {
        type: "event_msg",
        timestamp: "2026-06-22T10:00:00.000Z",
        payload: {
          type: "user_message",
          message: "latest prompt"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-22T10:00:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "latest answer"
            }
          ]
        }
      }
    ]),
    "session-offset",
    2,
    20400
  );

  assert.deepEqual(
    transcript.map((entry) => entry.id),
    ["session-offset-20400", "session-offset-20401"]
  );
});
