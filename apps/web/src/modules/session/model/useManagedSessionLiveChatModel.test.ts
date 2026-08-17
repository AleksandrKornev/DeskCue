import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveContextCompactionCount,
  resolveLiveHeaderStatus,
  resolveLiveHeaderStatusLabel
} from "./liveChat/helpers";

describe("managed session live chat model", () => {
  it("keeps the compaction count monotonic across detail and summary refreshes", () => {
    assert.equal(resolveContextCompactionCount(0, 12), 12);
    assert.equal(resolveContextCompactionCount(15, 12), 15);
    assert.equal(resolveContextCompactionCount(undefined, undefined), 0);
  });

  it("shows running while a DeskCue prompt is in flight", () => {
    assert.equal(
      resolveLiveHeaderStatus({
        isPromptInFlight: true,
        sessionShell: {
          sourceSessionId: "source-1",
          status: "read_only"
        },
        takenOverAgentSession: {
          workState: "idle"
        }
      }),
      "running"
    );
  });

  it("shows running when the source chat is working", () => {
    assert.equal(
      resolveLiveHeaderStatus({
        isPromptInFlight: false,
        sessionShell: {
          sourceSessionId: "source-1",
          status: "read_only"
        },
        takenOverAgentSession: {
          workState: "running"
        }
      }),
      "running"
    );
  });

  it("falls back to the shell status for a manual session", () => {
    assert.equal(
      resolveLiveHeaderStatus({
        isPromptInFlight: false,
        sessionShell: {
          sourceSessionId: null,
          status: "read_only"
        },
        takenOverAgentSession: null
      }),
      "read_only"
    );
  });

  it("labels an idle resumable source chat as ready", () => {
    assert.equal(
      resolveLiveHeaderStatusLabel({
        isPromptInFlight: false,
        sessionShell: {
          sourceSessionId: "source-1",
          status: "read_only"
        },
        takenOverAgentSession: {
          attachMode: "resume",
          workState: "idle"
        }
      }),
      "ready"
    );
  });

  it("does not label an active source chat as ready", () => {
    assert.equal(
      resolveLiveHeaderStatusLabel({
        isPromptInFlight: false,
        sessionShell: {
          sourceSessionId: "source-1",
          status: "read_only"
        },
        takenOverAgentSession: {
          attachMode: "resume",
          workState: "running"
        }
      }),
      undefined
    );
  });

  it("uses a terminal source turn instead of a stale running work state", () => {
    const takenOverAgentSession = {
      attachMode: "resume" as const,
      turnState: {
        activityAt: "2026-07-31T10:00:05.000Z",
        completedAt: "2026-07-31T10:00:05.000Z",
        evidence: "terminal_lifecycle" as const,
        fingerprint: "turn-1",
        phase: "completed" as const,
        startedAt: "2026-07-31T10:00:00.000Z"
      },
      workState: "running" as const
    };

    assert.equal(resolveLiveHeaderStatus({
      isPromptInFlight: false,
      sessionShell: { sourceSessionId: "source-1", status: "running" },
      takenOverAgentSession
    }), "read_only");
    assert.equal(resolveLiveHeaderStatusLabel({
      isPromptInFlight: false,
      sessionShell: { sourceSessionId: "source-1", status: "running" },
      takenOverAgentSession
    }), "ready");
  });

  it("labels a non-resumable source chat as read only", () => {
    assert.equal(
      resolveLiveHeaderStatusLabel({
        isPromptInFlight: false,
        sessionShell: {
          sourceSessionId: "source-1",
          status: "read_only"
        },
        takenOverAgentSession: {
          attachMode: "read_only",
          workState: "idle"
        }
      }),
      "read only"
    );
  });

  it("shows stopping while the server is confirming an interrupt", () => {
    const takenOverAgentSession = {
      workState: "running" as const,
      interruptLifecycle: {
        phase: "requested" as const,
        requestedAt: "2026-07-30T10:00:00.000Z",
        confirmedAt: null,
        turnFingerprint: "turn-1",
        confirmation: null
      }
    };

    assert.equal(resolveLiveHeaderStatus({
      isPromptInFlight: false,
      sessionShell: { sourceSessionId: "source-1", status: "read_only" },
      takenOverAgentSession
    }), "running");
    assert.equal(resolveLiveHeaderStatusLabel({
      isPromptInFlight: false,
      sessionShell: { sourceSessionId: "source-1", status: "read_only" },
      takenOverAgentSession: { ...takenOverAgentSession, attachMode: "read_only" }
    }), "stopping");
  });

  it("does not claim a source chat is running after an unconfirmed interrupt", () => {
    const takenOverAgentSession = {
      workState: "running" as const,
      interruptLifecycle: {
        phase: "unresolved" as const,
        requestedAt: "2026-07-30T10:00:00.000Z",
        confirmedAt: null,
        turnFingerprint: "turn-1",
        confirmation: null
      }
    };

    assert.equal(resolveLiveHeaderStatus({
      isPromptInFlight: false,
      sessionShell: { sourceSessionId: "source-1", status: "read_only" },
      takenOverAgentSession
    }), "read_only");
    assert.equal(resolveLiveHeaderStatusLabel({
      isPromptInFlight: false,
      sessionShell: { sourceSessionId: "source-1", status: "read_only" },
      takenOverAgentSession: { ...takenOverAgentSession, attachMode: "read_only" }
    }), "interrupt unconfirmed");
  });
});
