import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionDetail } from "@deskcue/protocol";

import {
  resolveSelectedAgentSessionTranscriptDetail,
  shouldAutoRefreshManagedSessionDiff
} from "./helpers";

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
