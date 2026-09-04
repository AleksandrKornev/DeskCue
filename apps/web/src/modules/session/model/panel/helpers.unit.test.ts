import { describe, expect, it } from "vitest";

import type { ChatTranscriptEntry } from "@modules/session/types";

import {
  hasConfirmedExternalSourceReply,
  isTranscriptHistoryKnownIncomplete,
  resolveReplyOutcome,
  stabilizeExternalSourceComposerState
} from "./helpers";

function entry(
  id: string,
  role: ChatTranscriptEntry["role"],
  phase: ChatTranscriptEntry["phase"] = null
): ChatTranscriptEntry {
  return {
    id,
    phase,
    role,
    text: id,
    timestamp: `2026-09-02T12:00:${id === "assistant-old" ? "00" : "10"}.000Z`
  };
}

describe("hasConfirmedExternalSourceReply", () => {
  const completedTurn = {
    attachMode: "read_only" as const,
    turnState: {
      activityAt: null,
      completedAt: "2026-09-02T12:00:11.000Z",
      evidence: "terminal_lifecycle" as const,
      fingerprint: "terminal-current",
      phase: "completed" as const,
      startedAt: null,
      turnStartFingerprint: "user-current"
    },
    workState: "idle" as const
  };

  it("does not let an older final reply confirm a newer completed turn", () => {
    expect(hasConfirmedExternalSourceReply(completedTurn, [
      entry("assistant-old", "assistant", "final"),
      entry("user-current", "user")
    ])).toBe(false);
  });

  it("requires a final assistant entry after the matching turn start", () => {
    const prefix = [
      entry("assistant-old", "assistant", "final"),
      entry("user-current", "user")
    ];

    expect(hasConfirmedExternalSourceReply(completedTurn, [
      ...prefix,
      entry("assistant-current", "assistant", "non_final")
    ])).toBe(false);
    expect(hasConfirmedExternalSourceReply(completedTurn, [
      ...prefix,
      entry("assistant-current", "assistant", "final")
    ])).toBe(true);
  });

  it("uses the preserved start time when the turn starts with a lifecycle entry", () => {
    const lifecycleTurn = {
      ...completedTurn,
      turnState: {
        ...completedTurn.turnState,
        startedAt: "2026-09-02T12:00:05.000Z",
        turnStartFingerprint: "lifecycle-start"
      }
    };

    expect(hasConfirmedExternalSourceReply(lifecycleTurn, [
      entry("assistant-old", "assistant", "final"),
      entry("assistant-current", "assistant", "final")
    ])).toBe(true);
  });

  it("does not use an old final at the exact turn start timestamp as confirmation", () => {
    const lifecycleTurn = {
      ...completedTurn,
      turnState: {
        ...completedTurn.turnState,
        startedAt: "2026-09-02T12:00:05.000Z",
        turnStartFingerprint: "lifecycle-start"
      }
    };

    const oldReplyAtTurnStart = {
      ...entry("assistant-old", "assistant", "final"),
      timestamp: "2026-09-02T12:00:05.000Z"
    };

    expect(hasConfirmedExternalSourceReply(lifecycleTurn, [oldReplyAtTurnStart])).toBe(false);
  });

  it("does not confirm a turn when its preserved start time is malformed", () => {
    const malformedLifecycleTurn = {
      ...completedTurn,
      turnState: {
        ...completedTurn.turnState,
        startedAt: "not-a-date",
        turnStartFingerprint: "lifecycle-start"
      }
    };

    expect(hasConfirmedExternalSourceReply(malformedLifecycleTurn, [
      entry("assistant-old", "assistant", "final")
    ])).toBe(false);
  });

  it("does not let a stale terminal turn dismiss a newly requested reply", () => {
    const staleTerminalTurn = {
      ...completedTurn,
      turnState: {
        ...completedTurn.turnState,
        startedAt: "2026-09-02T12:00:05.000Z"
      }
    };

    expect(hasConfirmedExternalSourceReply(
      staleTerminalTurn,
      [entry("assistant-current", "assistant", "final")],
      "2026-09-02T12:00:20.000Z"
    )).toBe(false);
  });

  it("confirms a terminal turn that started after the requested reply", () => {
    const currentTerminalTurn = {
      ...completedTurn,
      turnState: {
        ...completedTurn.turnState,
        startedAt: "2026-09-02T12:00:05.000Z"
      }
    };

    expect(hasConfirmedExternalSourceReply(
      currentTerminalTurn,
      [entry("assistant-current", "assistant", "final")],
      "2026-09-02T12:00:01.000Z"
    )).toBe(true);
  });
});

describe("resolveReplyOutcome", () => {
  it("does not announce a received reply for completion without a final assistant message", () => {
    expect(resolveReplyOutcome(null, null, false)).toBeNull();
  });

  it("preserves explicit source and interrupt outcomes", () => {
    expect(resolveReplyOutcome("failed", null, false)).toBe("failed");
    expect(resolveReplyOutcome(null, "interrupted", false)).toBe("interrupted");
    expect(resolveReplyOutcome(null, null, true)).toBe("completed");
  });
});

describe("stabilizeExternalSourceComposerState", () => {
  const availableComposer = {
    canSendInput: true,
    composerPromptInFlight: true,
    inputUnavailableLabel: null
  };

  it("keeps the composer blocked while an external waiting surface is held", () => {
    expect(stabilizeExternalSourceComposerState(availableComposer, true)).toEqual({
      canSendInput: false,
      composerPromptInFlight: false,
      inputUnavailableLabel: "Another client controls this turn. Finish or stop it there first."
    });
  });

  it("preserves a more specific unavailable reason", () => {
    expect(stabilizeExternalSourceComposerState({
      ...availableComposer,
      inputUnavailableLabel: "Prompt recovery is required"
    }, true).inputUnavailableLabel).toBe("Prompt recovery is required");
  });

  it("leaves the composer unchanged without a stable external turn", () => {
    expect(stabilizeExternalSourceComposerState(availableComposer, false))
      .toBe(availableComposer);
  });
});

describe("isTranscriptHistoryKnownIncomplete", () => {
  it("distinguishes unknown, complete, and bounded incomplete history", () => {
    expect(isTranscriptHistoryKnownIncomplete(new Map(), "codex:one")).toBe(false);
    expect(isTranscriptHistoryKnownIncomplete(new Map([["codex:one", false]]), "codex:one"))
      .toBe(false);
    expect(isTranscriptHistoryKnownIncomplete(new Map([["codex:one", true]]), "codex:one"))
      .toBe(true);
  });
});
