import type {
  AgentSessionDetail,
  SessionDetail
} from "@deskcue/protocol";
import {
  hasPromptCompletionInTranscript,
  hasPromptConfirmationInTranscript
} from "@models/promptDelivery";
import type { PendingChatPrompt } from "@models/promptDelivery";
import { getSessionInterruptLifecycle } from "@models/sessionInterruptLifecycle";

export type LocalInterruptMarker = {
  managedSessionId: string;
  sourceSessionId: string | null;
  priorInterruptRequestedAt: string | null;
  priorInterruptTurnFingerprint: string | null;
  priorTurnCompletedAt: string | null;
  priorTurnFingerprint: string | null;
};

export function buildPromptStateKey(text: string, requestedAt: string) {
  return `${requestedAt}\u0000${text}`;
}

function isPromptTrackableSourceSession(
  session: Pick<SessionDetail, "sourceSessionId" | "status"> | null
) {
  return Boolean(session?.sourceSessionId) &&
    (session?.status === "running" || session?.status === "read_only");
}

export function buildReplyStateDrivenPendingChatPrompt(
  selectedSession: SessionDetail | null,
  activeTakenOverAgentSession: AgentSessionDetail | null
): PendingChatPrompt | null {
  const replyState = selectedSession?.replyState;
  if (
    !selectedSession?.sourceSessionId ||
    !isPromptTrackableSourceSession(selectedSession) ||
    (replyState?.phase !== "queued" &&
      replyState?.phase !== "sending" &&
      replyState?.phase !== "waiting") ||
    !replyState.promptText ||
    !replyState.requestedAt
  ) {
    return null;
  }

  const nextPrompt = {
    text: replyState.promptText,
    requestedAt: replyState.requestedAt,
    sessionId: selectedSession.id,
    sourceSessionId: selectedSession.sourceSessionId,
    status: replyState.phase
  };

  const promptWasCompleted = hasPromptCompletionInTranscript(
    activeTakenOverAgentSession,
    nextPrompt
  );
  const promptWasConfirmed = hasPromptConfirmationInTranscript(
    activeTakenOverAgentSession,
    nextPrompt
  );

  if (promptWasCompleted) {
    return null;
  }

  if (promptWasConfirmed) {
    return {
      text: replyState.promptText,
      requestedAt: replyState.requestedAt,
      sessionId: selectedSession.id,
      sourceSessionId: selectedSession.sourceSessionId,
      status: "waiting"
    };
  }

  return {
    text: replyState.promptText,
    requestedAt: replyState.requestedAt,
    sessionId: selectedSession.id,
    sourceSessionId: selectedSession.sourceSessionId,
    status: replyState.phase
  };
}

export function resolveEffectivePromptState({
  awaitingChatReplySince,
  isWaitingForChatReply,
  pendingChatPrompt,
  replyStateDrivenPendingChatPrompt,
  selectedSession
}: {
  awaitingChatReplySince: string | null;
  isWaitingForChatReply: boolean;
  pendingChatPrompt: PendingChatPrompt | null;
  replyStateDrivenPendingChatPrompt: PendingChatPrompt | null;
  selectedSession: SessionDetail | null;
}) {
  const awaitingReplyPrompt =
    isWaitingForChatReply &&
    awaitingChatReplySince
      ? pendingChatPrompt?.status === "waiting"
        ? pendingChatPrompt
        : replyStateDrivenPendingChatPrompt
          ? {
              ...replyStateDrivenPendingChatPrompt,
              status: "waiting" as const
            }
          : null
      : null;

  const shouldKeepWaitingPendingPrompt =
    Boolean(awaitingReplyPrompt) ||
    (
      pendingChatPrompt?.status === "waiting" &&
      pendingChatPrompt.text.trim() === replyStateDrivenPendingChatPrompt?.text.trim()
    );

  const effectivePendingChatPrompt = awaitingReplyPrompt
      ? awaitingReplyPrompt
    : shouldKeepWaitingPendingPrompt
      ? pendingChatPrompt
      : replyStateDrivenPendingChatPrompt ?? pendingChatPrompt;

  const selectedReplyStateIsWaiting =
    selectedSession?.sourceSessionId &&
    isPromptTrackableSourceSession(selectedSession) &&
    selectedSession.replyState.phase === "waiting";
  const selectedReplyStateHasPrompt =
    Boolean(selectedSession?.replyState.promptText) &&
    Boolean(selectedSession?.replyState.requestedAt);

  const effectiveIsWaitingForChatReply =
    selectedReplyStateIsWaiting
      ? selectedReplyStateHasPrompt
        ? replyStateDrivenPendingChatPrompt?.status === "waiting"
        : true
      : shouldKeepWaitingPendingPrompt
        ? true
      : replyStateDrivenPendingChatPrompt?.status === "waiting"
        ? true
      : replyStateDrivenPendingChatPrompt?.status === "sending" ||
          replyStateDrivenPendingChatPrompt?.status === "queued"
        ? false
        : isWaitingForChatReply;

  return {
    effectiveIsWaitingForChatReply: Boolean(effectiveIsWaitingForChatReply),
    effectivePendingChatPrompt
  };
}

export function shouldClearLocalInterruptForSourceState(
  marker: LocalInterruptMarker | null,
  sourceSession: Pick<
    AgentSessionDetail,
    "sourceSessionId" | "interruptLifecycle" | "turnState"
  > | null
) {
  if (!marker || marker.sourceSessionId !== sourceSession?.sourceSessionId) {
    return false;
  }

  const lifecycle = getSessionInterruptLifecycle(sourceSession);
  const hasCurrentLifecycle =
    (lifecycle.requestedAt !== marker.priorInterruptRequestedAt ||
      lifecycle.turnFingerprint !== marker.priorInterruptTurnFingerprint) &&
    (lifecycle.phase === "confirmed" || lifecycle.phase === "unresolved");
  if (hasCurrentLifecycle) {
    return true;
  }

  const turnState = sourceSession.turnState;
  return (
    (turnState?.phase === "completed" ||
      turnState?.phase === "failed" ||
      turnState?.phase === "interrupted") &&
    (turnState.completedAt !== marker.priorTurnCompletedAt ||
      turnState.fingerprint !== marker.priorTurnFingerprint)
  );
}
