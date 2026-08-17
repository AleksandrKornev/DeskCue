import assert from "node:assert/strict";
import test from "node:test";

import { parseLmStudioDesktopConversation } from "./lmStudioDesktopImport.ts";

test("imports only selected user and assistant text from an LM Studio Desktop export", () => {
  const imported = parseLmStudioDesktopConversation(JSON.stringify({
    systemPrompt: "Use concise answers.",
    messages: [
      {
        currentlySelected: 1,
        versions: [
          { role: "user", content: [{ type: "text", text: "discarded" }] },
          { role: "user", content: [{ type: "text", text: "Keep this" }, { type: "file", name: "secret.txt" }] }
        ]
      },
      {
        currentlySelected: 0,
        versions: [{
          role: "assistant",
          steps: [
            { type: "debugInfoBlock", content: [{ type: "text", text: "hidden" }] },
            { type: "contentBlock", shouldIncludeInContext: false, content: [{ type: "text", text: "excluded" }] },
            { type: "contentBlock", content: [{ type: "text", text: "Visible reply" }] }
          ]
        }]
      }
    ]
  }));

  assert.equal(imported.systemPrompt, "Use concise answers.");
  assert.deepEqual(imported.messages, [
    { role: "user", text: "Keep this" },
    { role: "assistant", text: "Visible reply" }
  ]);
});

test("refuses invalid LM Studio Desktop exports", () => {
  assert.throws(() => parseLmStudioDesktopConversation("not json"));
  assert.throws(() => parseLmStudioDesktopConversation(JSON.stringify({ messages: [] })));
});
