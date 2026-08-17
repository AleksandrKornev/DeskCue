import type { AgentSessionDetail, SessionDetail, SessionSummary } from "@deskcue/protocol";
import type { PendingChatPrompt } from "@models/promptDelivery";

export function isPendingPromptForSelection(
  prompt: PendingChatPrompt | null,
  selectedSessionId: string,
  selectedSourceSessionId: string | null
) {
  if (!prompt) return false;

  if (prompt.sessionId) return prompt.sessionId === selectedSessionId;

  if (prompt.sourceSessionId) return prompt.sourceSessionId === selectedSourceSessionId;

  return false;
}

export function hasManagedSessionCompletedPendingPrompt(
  selectedSession: SessionDetail | null,
  prompt: PendingChatPrompt
) {
  if (
    !selectedSession ||
    selectedSession.replyState.phase !== "idle" ||
    !isPendingPromptForSelection(
      prompt,
      selectedSession.id,
      selectedSession.sourceSessionId
    )
  ) {
    return false;
  }

  const requestedAt = new Date(prompt.requestedAt).getTime();
  const lastActivityAt = new Date(selectedSession.lastActivityAt).getTime();
  if (Number.isNaN(requestedAt) || Number.isNaN(lastActivityAt)) return false;

  return lastActivityAt >= requestedAt;
}

export function hasPromptWaitedLongerThan(prompt: PendingChatPrompt, durationMs: number) {
  const requestedAt = new Date(prompt.requestedAt).getTime();
  if (Number.isNaN(requestedAt)) return false;

  return Date.now() - requestedAt >= durationMs;
}

export function getExternalCodexDesktopThreadUrl(
  selectedSession: SessionDetail | null,
  agentSession: AgentSessionDetail | null
) {
  if (
    selectedSession?.adapterId !== "codex" ||
    !selectedSession.sourceSessionId ||
    agentSession?.agentId !== "codex" ||
    agentSession.originator !== "Codex Desktop" ||
    agentSession.source !== "vscode" ||
    agentSession.sourceSessionId !== selectedSession.sourceSessionId
  ) {
    return null;
  }

  return `codex://threads/${encodeURIComponent(selectedSession.sourceSessionId)}`;
}

export function shouldAwaitSourceInterruptConfirmation(
  sourceSessionId: string | null | undefined,
  session: Pick<SessionSummary, "canSendInput" | "replyState" | "status">,
  options: { wasQueuedPrompt?: boolean } = {}
) {
  if (options.wasQueuedPrompt) return false;

  const hasManagedTerminalInterruptResult =
    session.status === "stopped" &&
    session.replyState.phase === "idle" &&
    session.canSendInput === true;

  return Boolean(sourceSessionId) && !hasManagedTerminalInterruptResult;
}

export function buildSourceAgentSessionId(session: SessionDetail | null) {
  if (!session?.adapterId || !session.sourceSessionId) return "";

  return `${session.adapterId}:${session.sourceSessionId}`;
}
