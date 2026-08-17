import assert from "node:assert/strict";
import test from "node:test";

import { prepareServerEventForRealtime } from "./serverEvents.ts";

test("local LLM completion realtime event keeps invalidation metadata but omits the answer", () => {
  const prepared = prepareServerEventForRealtime({
    type: "local.llm.chat.finished",
    payload: {
      answer: "private and potentially very large generated answer",
      chatId: "chat-1",
      completedAt: "2026-08-06T00:00:00.000Z",
      error: null,
      model: "model",
      runtimeId: "ollama",
      status: "completed",
      title: "Chat"
    }
  });

  assert.equal(prepared.type, "local.llm.chat.finished");
  assert.equal(prepared.payload.answer, null);
  assert.equal(prepared.payload.chatId, "chat-1");
  assert.equal(prepared.payload.status, "completed");
});
