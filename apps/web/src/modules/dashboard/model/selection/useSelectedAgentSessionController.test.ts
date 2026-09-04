import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionDetail } from "@deskcue/protocol";

import {
  resolveSelectedAgentSessionLoadError,
  resolveSelectedAgentSessionTranscriptDetail,
  shouldAutoRefreshManagedSessionDiff
} from "./helpers";

function createAgentChatDetailSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    detail: null,
    error: null,
    etag: null,
    isStale: false,
    lastLoadedAt: null,
    lastValidatedAt: null,
    retryAfterAt: null,
    retryAttempt: 0,
    sessionId: "agent-1",
    sourceVersion: null,
    staleReason: null,
    status: "idle" as const,
    updatedAt: null,
    ...overrides
  };
}

describe("selected agent session controller", () => {
  it("uses summary detail before a managed session is attached", () => {
    assert.equal(
      resolveSelectedAgentSessionTranscriptDetail("overview", null),
      "summary"
    );

    assert.equal(
      resolveSelectedAgentSessionTranscriptDetail("activity", null),
      "summary"
    );
  });

  it("uses summary detail for attached source sessions", () => {
    assert.equal(
      resolveSelectedAgentSessionTranscriptDetail("diff", {
        sourceSessionId: "source-1"
      } as SessionDetail),
      "summary"
    );
  });

  it("keeps manual managed sessions on full detail", () => {
    assert.equal(
      resolveSelectedAgentSessionTranscriptDetail("overview", {
        sourceSessionId: null
      } as SessionDetail),
      "full"
    );
  });

  it("exposes a safe local recovery message for the selected failed chat", () => {
    assert.equal(
      resolveSelectedAgentSessionLoadError(
        true,
        "agent-1",
        createAgentChatDetailSnapshot({ error: new Error("private transport detail") })
      ),
      "This local transcript may have changed or the daemon may be unavailable. Return to chats or try again."
    );
  });

  it("does not leak a stale or content-backed resource error into the selected chat", () => {
    assert.equal(
      resolveSelectedAgentSessionLoadError(
        true,
        "agent-2",
        createAgentChatDetailSnapshot({ error: new Error("old selection") })
      ),
      null
    );

    assert.equal(
      resolveSelectedAgentSessionLoadError(
        true,
        "agent-1",
        createAgentChatDetailSnapshot({
          detail: { id: "agent-1" },
          error: new Error("stale refresh")
        })
      ),
      null
    );
  });

  it("refreshes workspace git for a source-agent diff tab", () => {
    assert.equal(shouldAutoRefreshManagedSessionDiff(
      "diff",
      "managed-1"
    ), true);
  });

  it("keeps automatic git refresh for a manual managed diff tab", () => {
    assert.equal(shouldAutoRefreshManagedSessionDiff(
      "diff",
      "managed-1"
    ), true);
  });

  it("does not refresh workspace git outside Changes", () => {
    assert.equal(shouldAutoRefreshManagedSessionDiff("overview", "managed-1"), false);
    assert.equal(shouldAutoRefreshManagedSessionDiff("diff", ""), false);
  });
});
