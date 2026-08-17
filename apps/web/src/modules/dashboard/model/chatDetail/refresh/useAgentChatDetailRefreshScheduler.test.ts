import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentChatDetailResourceSnapshot } from "@modules/dashboard/model/chatDetail/resource/agentChatDetailResource";

import {
  mergeAgentChatDetailRefreshOptions,
  readDefaultTranscriptDetail,
  resolveAgentChatDetailReadTranscriptDetail,
  shouldSkipPassiveAgentChatDetailRefresh
} from "./helpers";
import type { AgentChatDetailReadTranscriptDetail } from "./types";

function createSnapshot(
  overrides: Partial<AgentChatDetailResourceSnapshot> = {}
): AgentChatDetailResourceSnapshot {
  return {
    detail: {
      agentId: "codex",
      agentLabel: "Codex",
      attachMode: "resume",
      cliVersion: null,
      filePath: "codex.jsonl",
      id: "agent-1",
      model: null,
      originator: null,
      reviewedAt: null,
      source: null,
      sourceSessionId: "source-1",
      title: "Agent chat",
      transcript: [],
      updatedAt: "2026-07-26T10:00:00.000Z",
      workspaceName: null,
      workspacePath: null,
      workState: "idle"
    },
    error: null,
    etag: "\"agent-1:v1\"",
    isStale: false,
    lastLoadedAt: 10_000,
    lastValidatedAt: 10_000,
    retryAfterAt: null,
    retryAttempt: 0,
    sessionId: "agent-1",
    sourceVersion: "\"agent-1:v1\"",
    staleReason: null,
    status: "synced",
    updatedAt: "2026-07-26T10:00:00.000Z",
    ...overrides
  };
}

describe("agent chat detail refresh scheduler helpers", () => {
  it("uses a stable default transcript detail reader", () => {
    assert.equal(
      resolveAgentChatDetailReadTranscriptDetail(undefined),
      readDefaultTranscriptDetail
    );
    assert.equal(
      resolveAgentChatDetailReadTranscriptDetail(undefined),
      resolveAgentChatDetailReadTranscriptDetail(undefined)
    );
  });

  it("uses summary transcript detail on chat overview by default", () => {
    assert.equal(readDefaultTranscriptDetail("overview"), "summary");
    assert.equal(readDefaultTranscriptDetail("activity"), "full");
  });

  it("keeps caller-provided transcript detail reader", () => {
    const customReader: AgentChatDetailReadTranscriptDetail = () => "full";

    assert.equal(
      resolveAgentChatDetailReadTranscriptDetail(customReader),
      customReader
    );
  });

  it("skips passive wake refreshes when detail was just validated", () => {
    assert.equal(
      shouldSkipPassiveAgentChatDetailRefresh({
        minIntervalMs: 5_000,
        now: 20_000,
        options: {
          reason: "mobile-resume"
        },
        snapshot: createSnapshot({
          lastValidatedAt: 10_001
        }),
        updatedAt: undefined
      }),
      true
    );
  });

  it("keeps live-event refreshes realtime even after recent validation", () => {
    assert.equal(
      shouldSkipPassiveAgentChatDetailRefresh({
        minIntervalMs: 15_000,
        now: 20_000,
        options: {
          reason: "live-event"
        },
        snapshot: createSnapshot({
          lastValidatedAt: 19_500
        }),
        updatedAt: "2026-07-26T10:01:00.000Z"
      }),
      false
    );
  });

  it("does not skip passive refreshes for stale snapshots", () => {
    assert.equal(
      shouldSkipPassiveAgentChatDetailRefresh({
        minIntervalMs: 15_000,
        now: 20_000,
        options: {
          reason: "focus"
        },
        snapshot: createSnapshot({
          isStale: true,
          lastValidatedAt: 19_500,
          status: "stale"
        }),
        updatedAt: undefined
      }),
      false
    );
  });

  it("keeps a queued terminal refresh forced and full", () => {
    assert.deepEqual(
      mergeAgentChatDetailRefreshOptions(
        {
          allowDuringPromptPolling: true,
          reason: "live-event"
        },
        {
          force: true,
          fullTranscript: true
        }
      ),
      {
        allowDuringPromptPolling: true,
        force: true,
        fullTranscript: true,
        reason: "live-event"
      }
    );
  });
});
