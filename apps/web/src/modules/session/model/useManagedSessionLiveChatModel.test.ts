import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSessionSummary } from "@deskcue/protocol";

import {
  findManagedSourceSessionSummary,
  resolveContextCompactionCount,
  resolveLiveHeaderStatus,
  resolveLiveHeaderStatusLabel,
  resolveLiveSourceState
} from "./liveChat/helpers";

describe("managed session live chat model", () => {
  it("does not select another adapter with the same source session id", () => {
    const wrongAdapter = {
      agentId: "claude-code",
      id: "claude-code:shared-source",
      sourceSessionId: "shared-source"
    } as AgentSessionSummary;
    const expected = {
      agentId: "codex",
      id: "codex:shared-source",
      sourceSessionId: "shared-source"
    } as AgentSessionSummary;

    assert.equal(findManagedSourceSessionSummary(
      [wrongAdapter, expected],
      {
        adapterId: "codex",
        sourceSessionId: "shared-source"
      },
      null
    ), expected);
    assert.equal(findManagedSourceSessionSummary(
      [wrongAdapter, expected],
      {
        adapterId: "codex",
        sourceSessionId: "shared-source"
      },
      { id: expected.id }
    ), expected);
  });

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

  it("shows retry required instead of ready after a prompt was definitely not sent", () => {
    assert.equal(
      resolveLiveHeaderStatusLabel({
        isPromptInFlight: false,
        sessionShell: {
          inputBlockedReason: "Another Codex client still owns this chat.",
          promptRecovery: {
            phase: "not_sent",
            promptText: "Continue",
            requestedAt: "2026-08-23T13:23:23.000Z",
            retryable: true
          },
          sourceSessionId: "source-1",
          status: "read_only"
        },
        takenOverAgentSession: {
          attachMode: "resume",
          workState: "idle"
        }
      }),
      "retry required"
    );
  });

  it("shows outcome recovery instead of running for a stale active source", () => {
    const sessionShell = {
      inputBlockedReason: "DeskCue lost control of this turn.",
      promptRecovery: {
        phase: "outcome_unknown" as const,
        promptText: "Continue",
        requestedAt: "2026-08-25T10:00:00.000Z",
        retryable: false
      },
      sourceSessionId: "source-1",
      status: "read_only" as const
    };

    const staleSourceSession = {
      attachMode: "resume" as const,
      workState: "running" as const
    };

    assert.equal(resolveLiveHeaderStatus({
      isPromptInFlight: true,
      sessionShell,
      takenOverAgentSession: staleSourceSession
    }), "read_only");
    assert.equal(resolveLiveHeaderStatusLabel({
      isPromptInFlight: true,
      sessionShell,
      takenOverAgentSession: staleSourceSession
    }), "control lost");
  });

  for (const terminalStatus of ["done", "stopped"] as const) {
    it(`shows control lost instead of ready for a ${terminalStatus} shell with unresolved recovery`, () => {
      assert.equal(
        resolveLiveHeaderStatusLabel({
          isPromptInFlight: false,
          sessionShell: {
            inputBlockedReason: "DeskCue lost control of this turn.",
            promptRecovery: {
              phase: "outcome_unknown",
              promptText: "Continue",
              requestedAt: "2026-08-25T10:00:00.000Z",
              retryable: false
            },
            sourceSessionId: "source-1",
            status: terminalStatus
          },
          takenOverAgentSession: {
            attachMode: "resume",
            workState: "idle"
          }
        }),
        "control lost"
      );
    });
  }

  it("does not hide a failed shell behind a ready source transcript", () => {
    const sessionShell = { sourceSessionId: "source-1", status: "failed" as const };
    const sourceSession = { attachMode: "resume" as const, workState: "idle" as const };

    assert.equal(resolveLiveHeaderStatus({
      isPromptInFlight: false,
      sessionShell,
      takenOverAgentSession: sourceSession
    }), "failed");
    assert.equal(resolveLiveHeaderStatusLabel({
      isPromptInFlight: false,
      sessionShell,
      takenOverAgentSession: sourceSession
    }), "failed");
  });

  it("keeps a completed resumable shell ready despite stale active source detail", () => {
    const sessionShell = { sourceSessionId: "source-1", status: "done" as const };
    const staleSourceSession = { attachMode: "resume" as const, workState: "running" as const };

    assert.equal(resolveLiveHeaderStatus({
      isPromptInFlight: true,
      sessionShell,
      takenOverAgentSession: staleSourceSession
    }), "done");
    assert.equal(resolveLiveHeaderStatusLabel({
      isPromptInFlight: true,
      sessionShell,
      takenOverAgentSession: staleSourceSession
    }), "ready");
  });

  it("keeps a stopped shell ready despite stale active source detail", () => {
    const sessionShell = { sourceSessionId: "source-1", status: "stopped" as const };
    const staleSourceSession = { attachMode: "resume" as const, workState: "running" as const };

    assert.equal(resolveLiveHeaderStatus({
      isPromptInFlight: true,
      sessionShell,
      takenOverAgentSession: staleSourceSession
    }), "stopped");
    assert.equal(resolveLiveHeaderStatusLabel({
      isPromptInFlight: true,
      sessionShell,
      takenOverAgentSession: staleSourceSession
    }), "ready");
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

  it("labels an active view-only source chat as observing", () => {
    assert.equal(
      resolveLiveHeaderStatusLabel({
        isPromptInFlight: false,
        sessionShell: {
          sourceSessionId: "source-1",
          status: "read_only"
        },
        takenOverAgentSession: {
          attachMode: "read_only",
          workState: "running"
        }
      }),
      "observing"
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

  it("uses a newer terminal list summary when the transcript detail still projects an active turn", () => {
    const detail = {
      attachMode: "resume" as const,
      turnState: {
        activityAt: "2026-08-22T16:40:30.000Z",
        completedAt: null,
        evidence: "recent_non_final_activity" as const,
        fingerprint: "turn-1",
        phase: "active" as const,
        startedAt: "2026-08-22T16:40:30.000Z"
      },
      workState: "running" as const
    };

    const summary = {
      attachMode: "resume" as const,
      turnState: {
        activityAt: null,
        completedAt: "2026-08-22T16:40:36.000Z",
        evidence: "terminal_lifecycle" as const,
        fingerprint: "turn-2",
        phase: "completed" as const,
        startedAt: null
      },
      workState: "idle" as const
    };

    assert.deepEqual(resolveLiveSourceState(detail, summary), summary);
  });

  it("does not let an older active list summary replace a newer terminal detail", () => {
    const detail = {
      attachMode: "resume" as const,
      turnState: {
        activityAt: null,
        completedAt: "2026-08-22T16:40:36.000Z",
        evidence: "terminal_lifecycle" as const,
        fingerprint: "turn-2",
        phase: "completed" as const,
        startedAt: null
      },
      workState: "idle" as const
    };

    const summary = {
      attachMode: "resume" as const,
      turnState: {
        activityAt: "2026-08-22T16:40:30.000Z",
        completedAt: null,
        evidence: "recent_non_final_activity" as const,
        fingerprint: "turn-1",
        phase: "active" as const,
        startedAt: "2026-08-22T16:40:30.000Z"
      },
      workState: "running" as const
    };

    assert.deepEqual(resolveLiveSourceState(detail, summary), detail);
  });

  it("labels a non-resumable source chat as view only", () => {
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
      "view only"
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
