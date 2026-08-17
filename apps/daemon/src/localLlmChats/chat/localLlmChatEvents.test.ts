import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LOCAL_LLM_CHAT_EVENTS_FILE,
  LocalLlmChatEventLedger,
  isTerminalEvent
} from "./localLlmChatEvents.ts";

test("local LLM event ledger keeps turn lifecycle records and skips malformed lines", async () => {
  const chatPath = await mkdtemp(path.join(os.tmpdir(), "deskcue-local-events-"));
  try {
    const ledger = new LocalLlmChatEventLedger(chatPath);
    await ledger.append({
      id: "event-start",
      turnId: "turn-1",
      type: "turn_started",
      timestamp: "2026-08-03T10:00:00.000Z",
      messageId: "user-1"
    });
    await appendFile(path.join(chatPath, LOCAL_LLM_CHAT_EVENTS_FILE), "not json\n", "utf8");
    await ledger.append({
      id: "event-complete",
      turnId: "turn-1",
      type: "turn_completed",
      timestamp: "2026-08-03T10:00:02.000Z"
    });

    const events = await ledger.read();
    assert.deepEqual(events.map((event) => event.type), ["turn_started", "turn_completed"]);
    assert.equal(await ledger.hasTerminalEvent("turn-1"), true);
    assert.equal(await ledger.hasTerminalEvent("missing-turn"), false);
    assert.equal(isTerminalEvent(events[0]!), false);
    assert.equal(isTerminalEvent(events[1]!), true);
  } finally {
    await rm(chatPath, { force: true, recursive: true });
  }
});
