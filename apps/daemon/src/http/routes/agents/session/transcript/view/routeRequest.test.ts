import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AGENT_SESSION_CHAT_MESSAGE_TAIL,
  DEFAULT_TRANSCRIPT_DELTA_OVERLAP_ITEM_COUNT,
  MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL,
  MAX_TRANSCRIPT_DELTA_OVERLAP_ITEM_COUNT
} from "./projection.ts";
import { MAX_AGENT_SESSION_TRANSCRIPT_TAIL } from "../routeHelpers.ts";
import { readTranscriptDeltaRouteRequest, readTranscriptViewRouteRequest } from "./routeRequest.ts";

test("uses the bounded chat tail for the default transcript view", () => {
  const request = readTranscriptViewRouteRequest({});

  assert.deepEqual(request, {
    chatMessageTail: DEFAULT_AGENT_SESSION_CHAT_MESSAGE_TAIL,
    fullTranscript: false,
    includeSessionSummary: false,
    transcriptDetail: "full",
    transcriptTail: null,
    transcriptViewOptions: {
      chatMessageTail: DEFAULT_AGENT_SESSION_CHAT_MESSAGE_TAIL,
      fullTranscript: false,
      includeSessionSummary: false,
      transcriptDetail: "full",
      transcriptTail: null,
      waitingSince: null
    },
    waitingSince: null
  });
});

test("maps legacy full transcript requests to the bounded cursor-friendly tail", () => {
  const fullRequest = readTranscriptViewRouteRequest({
    fullTranscript: "true",
    includeSessionSummary: "1",
    transcriptDetail: "summary",
    waitingSince: " 2026-08-05T10:00:00.000Z "
  });
  const tailRequest = readTranscriptViewRouteRequest({ transcriptTail: "17" });
  const cappedChatRequest = readTranscriptViewRouteRequest({
    chatMessageTail: String(MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL + 50)
  });

  assert.equal(fullRequest.chatMessageTail, MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL);
  assert.equal(fullRequest.fullTranscript, false);
  assert.equal(fullRequest.transcriptTail, null);
  assert.equal(fullRequest.includeSessionSummary, true);
  assert.equal(fullRequest.transcriptDetail, "summary");
  assert.equal(fullRequest.waitingSince, "2026-08-05T10:00:00.000Z");
  assert.equal(tailRequest.chatMessageTail, null);
  assert.equal(tailRequest.transcriptTail, 17);
  assert.equal(cappedChatRequest.chatMessageTail, MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL);
});

test("keeps an explicit chat-message boundary for legacy full refreshes", () => {
  const request = readTranscriptViewRouteRequest({
    chatMessageTail: "24",
    fullTranscript: "1",
    transcriptDetail: "summary"
  });

  assert.equal(request.chatMessageTail, 24);
  assert.equal(request.fullTranscript, false);
  assert.equal(request.transcriptTail, null);
});

test("caps an explicit transcript tail", () => {
  const request = readTranscriptViewRouteRequest({
    transcriptTail: String(MAX_AGENT_SESSION_TRANSCRIPT_TAIL + 1_000)
  });

  assert.equal(request.fullTranscript, false);
  assert.equal(request.transcriptTail, MAX_AGENT_SESSION_TRANSCRIPT_TAIL);
});

test("parses delta cursors and bounds overlap without changing its defaults", () => {
  const defaultRequest = readTranscriptDeltaRouteRequest({});
  const requested = readTranscriptDeltaRouteRequest({
    baseItemKey: " message:entry-8 ",
    baseSourceEntryId: " entry-8 ",
    overlapItemCount: String(MAX_TRANSCRIPT_DELTA_OVERLAP_ITEM_COUNT + 20)
  });

  assert.equal(
    defaultRequest.overlapItemCount,
    DEFAULT_TRANSCRIPT_DELTA_OVERLAP_ITEM_COUNT
  );

  assert.equal(defaultRequest.baseItemKey, null);
  assert.equal(defaultRequest.baseSourceEntryId, null);
  assert.equal(requested.baseItemKey, "message:entry-8");
  assert.equal(requested.baseSourceEntryId, "entry-8");
  assert.equal(
    requested.overlapItemCount,
    MAX_TRANSCRIPT_DELTA_OVERLAP_ITEM_COUNT
  );
});
