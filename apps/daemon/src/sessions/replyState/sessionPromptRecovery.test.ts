import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionDetail, SessionDetail } from "@deskcue/protocol";

import { reconcileSessionPromptRecovery } from "./sessionPromptRecovery.ts";

function recoverySession(
  phase: NonNullable<SessionDetail["promptRecovery"]>["phase"]
): Pick<SessionDetail, "inputHistory" | "promptRecovery"> {
  return {
    inputHistory: ["Recover me"],
    promptRecovery: {
      phase,
      promptText: "Recover me",
      requestedAt: "2026-08-11T10:00:00.000Z",
      retryable: phase === "not_sent"
    }
  };
}

function sourceSession(transcript: AgentSessionDetail["transcript"]): AgentSessionDetail {
  return {
    id: "codex:source-1",
    agentId: "codex",
    agentLabel: "Codex",
    sourceSessionId: "source-1",
    title: "Recovery",
    workspacePath: "C:/workspace",
    workspaceName: "Workspace",
    updatedAt: "2026-08-11T10:00:03.000Z",
    model: null,
    originator: null,
    cliVersion: null,
    source: null,
    filePath: "session.jsonl",
    attachMode: "resume",
    attachModeReason: null,
    workState: "running",
    transcript
  };
}

test("keeps a definitely-not-sent prompt retryable without transcript guessing", () => {
  const result = reconcileSessionPromptRecovery(
    recoverySession("not_sent"),
    sourceSession([])
  );

  assert.equal(result, null);
});

function transcriptEntry(
  id: string,
  role: "assistant" | "user",
  text: string,
  timestamp: string,
  phase: AgentSessionDetail["transcript"][number]["phase"] = null
): AgentSessionDetail["transcript"][number] {
  return {
    id,
    phase,
    role,
    text,
    timestamp
  };
}

test("moves a bounded source check without matching prompt to outcome unknown", () => {
  const result = reconcileSessionPromptRecovery(
    recoverySession("checking"),
    sourceSession([
      transcriptEntry("other-user", "user", "Another prompt", "2026-08-11T10:00:01.000Z")
    ])
  );

  assert.deepEqual(result, {
    confirmed: false,
    promptRecovery: {
      phase: "outcome_unknown",
      promptText: "Recover me",
      requestedAt: "2026-08-11T10:00:00.000Z",
      retryable: false
    },
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    }
  });
});

test("does not confuse an identical earlier prompt with the recovered delivery", () => {
  const result = reconcileSessionPromptRecovery(
    recoverySession("checking"),
    sourceSession([
      transcriptEntry("earlier-user", "user", "Recover me", "2026-08-11T09:59:50.000Z"),
      transcriptEntry("earlier-answer", "assistant", "Done", "2026-08-11T09:59:51.000Z")
    ])
  );

  assert.equal(result?.confirmed, false);
  assert.equal(result?.promptRecovery?.phase, "outcome_unknown");
});

test("keeps recovery unresolved when the prompt is visible without a terminal outcome", () => {
  const result = reconcileSessionPromptRecovery(
    recoverySession("checking"),
    sourceSession([
      transcriptEntry("recovered-user", "user", "Recover me", "2026-08-11T10:00:02.000Z")
    ])
  );

  assert.deepEqual(result, {
    confirmed: true,
    promptRecovery: {
      phase: "outcome_unknown",
      promptText: "Recover me",
      requestedAt: "2026-08-11T10:00:00.000Z",
      retryable: false
    },
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    }
  });
});

test("does not treat non-final assistant activity as a terminal outcome", () => {
  const result = reconcileSessionPromptRecovery(
    recoverySession("checking"),
    sourceSession([
      transcriptEntry("recovered-user", "user", "Recover me", "2026-08-11T10:00:02.000Z"),
      transcriptEntry(
        "recovered-commentary",
        "assistant",
        "Still working",
        "2026-08-11T10:00:03.000Z",
        "non_final"
      )
    ])
  );

  assert.equal(result?.confirmed, true);
  assert.equal(result?.promptRecovery?.phase, "outcome_unknown");
  assert.deepEqual(result?.replyState, {
    phase: "idle",
    promptText: null,
    requestedAt: null
  });
});

test("restores completed state when the recovered prompt already has a reply", () => {
  const result = reconcileSessionPromptRecovery(
    recoverySession("outcome_unknown"),
    sourceSession([
      transcriptEntry("recovered-user", "user", "Recover me", "2026-08-11T10:00:02.000Z"),
      transcriptEntry("recovered-answer", "assistant", "Done", "2026-08-11T10:00:03.000Z")
    ])
  );

  assert.deepEqual(result, {
    confirmed: true,
    promptRecovery: null,
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    }
  });
});

test("clears an existing unknown outcome after a late terminal lifecycle entry", () => {
  const result = reconcileSessionPromptRecovery(
    recoverySession("outcome_unknown"),
    sourceSession([
      transcriptEntry("recovered-user", "user", "Recover me", "2026-08-11T10:00:02.000Z"),
      {
        id: "turn-completed",
        phase: null,
        role: "system",
        text: "Turn completed",
        timestamp: "2026-08-11T10:00:04.000Z"
      }
    ])
  );

  assert.deepEqual(result, {
    confirmed: true,
    promptRecovery: null,
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    }
  });
});
