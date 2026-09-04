import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import type {
  AgentKind,
  AgentSessionSummary,
  SessionSummary
} from "@deskcue/protocol";

import { useAgentSessionsAttentionState } from "./useAgentSessionsAttentionState";

function createAgentSession(agentId: AgentKind, id: string) {
  return {
    agentId,
    agentLabel: agentId,
    attachMode: "resume",
    filePath: `${id}.jsonl`,
    id,
    sourceSessionId: "shared-source-id",
    title: id,
    updatedAt: "2026-09-04T10:00:00.000Z",
    workState: "idle"
  } as AgentSessionSummary;
}

function createManagedSession(overrides: Partial<SessionSummary>) {
  return {
    adapterId: "codex",
    finishedAt: null,
    id: "managed-codex",
    replyState: { phase: "idle" },
    sourceSessionId: "shared-source-id",
    status: "running",
    ...overrides
  } as SessionSummary;
}

it("keeps approval and work state scoped to the source provider", () => {
  const codex = createAgentSession("codex", "codex-session");
  const claude = createAgentSession("claude-code", "claude-session");
  const managedSession = createManagedSession({
    actionRequest: {
      command: "npm test",
      kind: "approval",
      reason: null,
      requestedAt: "2026-09-04T10:00:01.000Z"
    }
  });

  const { result } = renderHook(() => useAgentSessionsAttentionState({
    agentSessions: [codex, claude],
    managedSessions: [managedSession],
    pendingChatPrompt: null,
    readyForReviewAgentSessionIds: []
  }));

  expect(result.current.approvalRequestedSourceSessionKeys)
    .toEqual(new Set(["codex:shared-source-id"]));
  expect(result.current.workIndicatorsBySourceSessionKey.get("codex:shared-source-id")?.label)
    .toBe("Approval");
  expect(result.current.workIndicatorsBySourceSessionKey.has("claude-code:shared-source-id"))
    .toBe(false);
  expect(result.current.attentionSessions.map((session) => session.id)).toEqual([codex.id]);
});

it("does not mark another provider ready when a managed source finishes", () => {
  const codex = createAgentSession("codex", "codex-session");
  const claude = createAgentSession("claude-code", "claude-session");
  const managedSession = createManagedSession({
    finishedAt: "2026-09-04T10:00:02.000Z",
    status: "stopped"
  });

  const { result } = renderHook(() => useAgentSessionsAttentionState({
    agentSessions: [codex, claude],
    managedSessions: [managedSession],
    pendingChatPrompt: null,
    readyForReviewAgentSessionIds: []
  }));

  expect(result.current.effectiveReadyForReviewAgentSessionIds).toEqual(new Set([codex.id]));
  expect(result.current.attentionSessions.map((session) => session.id)).toEqual([codex.id]);
});

it("keeps a detached pending prompt waiting when its source provider is unambiguous", () => {
  const codex = createAgentSession("codex", "codex-session");

  const { result } = renderHook(() => useAgentSessionsAttentionState({
    agentSessions: [codex],
    managedSessions: [],
    pendingChatPrompt: {
      requestedAt: "2026-09-04T10:00:01.000Z",
      sourceSessionId: codex.sourceSessionId,
      status: "starting",
      text: "Continue"
    },
    readyForReviewAgentSessionIds: []
  }));

  expect(result.current.workIndicatorsBySourceSessionKey.get("codex:shared-source-id")?.label)
    .toBe("Waiting");
  expect(result.current.attentionSessions.map((session) => session.id)).toEqual([codex.id]);
});
