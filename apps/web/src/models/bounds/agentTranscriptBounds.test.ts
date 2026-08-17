import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentTranscriptEntry,
  AgentTranscriptViewItem,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";

import {
  boundLiveTranscriptEntries,
  boundLiveTranscriptView
} from "./agentTranscriptBounds";

test("bounds the automatic source transcript tail", () => {
  const entries = Array.from({ length: 700 }, (_, index) => ({
    id: `entry-${index}`
  } as AgentTranscriptEntry));
  const bounded = boundLiveTranscriptEntries(entries);

  assert.equal(bounded.length, 512);
  assert.equal(bounded[0]?.id, "entry-188");
  assert.equal(bounded.at(-1)?.id, "entry-699");
});

test("bounds the automatic transcript-view tail", () => {
  const items = Array.from({ length: 700 }, (_, index) => ({
    key: `item-${index}`
  } as AgentTranscriptViewItem));
  const bounded = boundLiveTranscriptView({
    items,
    sessionId: "codex:one"
  } as AgentTranscriptViewResponse);

  assert.equal(bounded?.items.length, 512);
  assert.equal(bounded?.items[0]?.key, "item-188");
  assert.equal(bounded?.items.at(-1)?.key, "item-699");
});
