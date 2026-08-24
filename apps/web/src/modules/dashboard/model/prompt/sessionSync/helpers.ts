import type {
  AgentSessionDetail,
  SessionDetail
} from "@deskcue/protocol";
import {
  hasPromptCompletionInTranscript,
  hasPromptConfirmationInTranscript
} from "@models/promptDelivery";
import type { PendingChatPrompt } from "@models/promptDelivery";
import {
  hasManagedSessionCompletedPendingPrompt,
  hasPromptWaitedLongerThan,
  isPendingPromptForSelection
} from "@modules/dashboard/model/prompt/helpers";

const CANCELLED_PROMPT_RETENTION_MS = 30_000;

type PromptSessionSyncAction =
  | { kind: "none" }
  | { kind: "reset" }
  | { kind: "clear-completed"; prompt: PendingChatPrompt }
  | { kind: "set-pending"; prompt: PendingChatPrompt }
  | { kind: "mark-waiting"; prompt: PendingChatPrompt }
  | { kind: "clear-waiting" };

export function shouldResetPromptStateForSelection({
  awaitingChatReplySince,
  isWaitingForChatReply,
  pendingChatPrompt,
  selectedSession,
  selectedSessionId
}: {
  awaitingChatReplySince: string | null;
  isWaitingForChatReply: boolean;
  pendingChatPrompt: PendingChatPrompt | null;
  selectedSession: SessionDetail | null;
  selectedSessionId: string;
}) {
  if (
    isPendingPromptForSelection(
      pendingChatPrompt,
      selectedSessionId,
      selectedSession?.sourceSessionId ?? null
    )
  ) {
    return false;
  }

  return Boolean(
    pendingChatPrompt ||
      awaitingChatReplySince ||
      isWaitingForChatReply
  );
}

function buildReplyStatePrompt(
  selectedSession: SessionDetail,
  status: PendingChatPrompt["status"]
): PendingChatPrompt | null {
  const replyState = selectedSession.replyState;

  if (!selectedSession.sourceSessionId || !replyState.promptText?.trim() || !replyState.requestedAt) return null;

  return {
    text: replyState.promptText,
    requestedAt: replyState.requestedAt,
    sessionId: selectedSession.id,
    sourceSessionId: selectedSession.sourceSessionId,
    status
  };
}

function resolvePendingPromptSyncAction({
  activeTakenOverAgentSession,
  awaitingChatReplySince,
  isWaitingForChatReply,
  pendingChatPrompt,
  selectedSession
}: {
  activeTakenOverAgentSession: AgentSessionDetail | null;
  awaitingChatReplySince: string | null;
  isWaitingForChatReply: boolean;
  pendingChatPrompt: PendingChatPrompt;
  selectedSession: SessionDetail;
}): PromptSessionSyncAction {
  if (
    pendingChatPrompt.status === "cancelled" &&
    hasPromptWaitedLongerThan(pendingChatPrompt, CANCELLED_PROMPT_RETENTION_MS)
  ) {
    return { kind: "reset" };
  }

  const promptWasCompleted = hasPromptCompletionInTranscript(
    activeTakenOverAgentSession,
    pendingChatPrompt
  );
  const promptWasConfirmed = hasPromptConfirmationInTranscript(
    activeTakenOverAgentSession,
    pendingChatPrompt
  );
  const promptIsStaleWithoutConfirmation =
    selectedSession.replyState.phase === "idle" &&
    pendingChatPrompt.status === "waiting" &&
    !promptWasConfirmed &&
    hasPromptWaitedLongerThan(pendingChatPrompt, CANCELLED_PROMPT_RETENTION_MS);

  if (promptIsStaleWithoutConfirmation) return { kind: "reset" };
  if (promptWasCompleted) return { kind: "clear-completed", prompt: pendingChatPrompt };

  if (
    hasManagedSessionCompletedPendingPrompt(selectedSession, pendingChatPrompt) &&
    pendingChatPrompt.status !== "waiting"
  ) {
    return { kind: "mark-waiting", prompt: pendingChatPrompt };
  }

  if (promptWasConfirmed && pendingChatPrompt.status !== "waiting") {
    return { kind: "mark-waiting", prompt: pendingChatPrompt };
  }

  if (pendingChatPrompt.status === "waiting" && !promptWasCompleted) {
    return !awaitingChatReplySince || !isWaitingForChatReply
      ? { kind: "mark-waiting", prompt: pendingChatPrompt }
      : { kind: "none" };
  }

  return { kind: "none" };
}

function resolveSendingPromptSyncAction({
  activeTakenOverAgentSession,
  awaitingChatReplySince,
  isWaitingForChatReply,
  pendingChatPrompt,
  selectedSession
}: {
  activeTakenOverAgentSession: AgentSessionDetail | null;
  awaitingChatReplySince: string | null;
  isWaitingForChatReply: boolean;
  pendingChatPrompt: PendingChatPrompt | null;
  selectedSession: SessionDetail;
}): PromptSessionSyncAction {
  const sendingPrompt = buildReplyStatePrompt(selectedSession, "waiting");

  if (!sendingPrompt) return { kind: "none" };

  if (hasPromptCompletionInTranscript(activeTakenOverAgentSession, sendingPrompt)) {
    return {
      kind: "clear-completed",
      prompt: {
        text: pendingChatPrompt?.text ?? sendingPrompt.text,
        requestedAt: pendingChatPrompt?.requestedAt ?? sendingPrompt.requestedAt,
        status: "waiting"
      }
    };
  }

  if (hasPromptConfirmationInTranscript(activeTakenOverAgentSession, sendingPrompt)) {
    const waitingPrompt = {
      ...sendingPrompt,
      requestedAt: pendingChatPrompt?.requestedAt ?? sendingPrompt.requestedAt,
      status: "waiting" as const
    };

    return isWaitingForChatReply && pendingChatPrompt?.status === "waiting"
      ? { kind: "none" }
      : { kind: "mark-waiting", prompt: waitingPrompt };
  }

  const isAwaitingSamePrompt =
    (isWaitingForChatReply || pendingChatPrompt?.status === "waiting") &&
    pendingChatPrompt?.text.trim() === selectedSession.replyState.promptText?.trim();

  if (isAwaitingSamePrompt) {
    const waitingPrompt = {
      ...sendingPrompt,
      requestedAt: pendingChatPrompt?.requestedAt ?? sendingPrompt.requestedAt
    };

    return hasPromptCompletionInTranscript(activeTakenOverAgentSession, waitingPrompt)
      ? { kind: "clear-completed", prompt: waitingPrompt }
      : { kind: "none" };
  }

  const pendingMatchesCurrent =
    pendingChatPrompt?.text.trim() === selectedSession.replyState.promptText?.trim() &&
    pendingChatPrompt?.requestedAt === selectedSession.replyState.requestedAt;

  return !pendingMatchesCurrent || awaitingChatReplySince || isWaitingForChatReply
    ? {
        kind: "set-pending",
        prompt: {
          ...sendingPrompt,
          status: "sending"
        }
      }
    : { kind: "none" };
}

export function resolvePromptSessionSyncAction({
  activeTakenOverAgentSession,
  awaitingChatReplySince,
  isInterruptingPrompt,
  isWaitingForChatReply,
  pendingChatPrompt,
  selectedSession
}: {
  activeTakenOverAgentSession: AgentSessionDetail | null;
  awaitingChatReplySince: string | null;
  isInterruptingPrompt: boolean;
  isWaitingForChatReply: boolean;
  pendingChatPrompt: PendingChatPrompt | null;
  selectedSession: SessionDetail | null;
}): PromptSessionSyncAction {
  if (isInterruptingPrompt) return { kind: "none" };

  const replyState = selectedSession?.replyState;
  const hasWritableRunningSourceSession =
    Boolean(selectedSession?.sourceSessionId) &&
    selectedSession?.status === "running" &&
    Boolean(replyState);
  const hasScopedWaitingPrompt =
    Boolean(selectedSession?.sourceSessionId) &&
    Boolean(selectedSession) &&
    pendingChatPrompt?.status === "waiting" &&
    isPendingPromptForSelection(
      pendingChatPrompt,
      selectedSession?.id ?? "",
      selectedSession?.sourceSessionId ?? null
    );
  const hasStoppedSourceSession =
    Boolean(selectedSession?.sourceSessionId) &&
    selectedSession?.status === "stopped" &&
    replyState?.phase === "idle";

  if (hasStoppedSourceSession) {
    return pendingChatPrompt || awaitingChatReplySince || isWaitingForChatReply
      ? { kind: "reset" }
      : { kind: "none" };
  }

  if (!hasWritableRunningSourceSession || !selectedSession || !replyState) {
    if (pendingChatPrompt?.status === "starting") return { kind: "none" };

    if (hasScopedWaitingPrompt && pendingChatPrompt) {
      return hasPromptCompletionInTranscript(activeTakenOverAgentSession, pendingChatPrompt)
        ? { kind: "clear-completed", prompt: pendingChatPrompt }
        : !awaitingChatReplySince || !isWaitingForChatReply
          ? { kind: "mark-waiting", prompt: pendingChatPrompt }
          : { kind: "none" };
    }

    return pendingChatPrompt || awaitingChatReplySince || isWaitingForChatReply
      ? { kind: "reset" }
      : { kind: "none" };
  }

  if (replyState.phase === "sending" && replyState.promptText && replyState.requestedAt) {
    return resolveSendingPromptSyncAction({
      activeTakenOverAgentSession,
      awaitingChatReplySince,
      isWaitingForChatReply,
      pendingChatPrompt,
      selectedSession
    });
  }

  if (replyState.phase === "queued" && replyState.promptText && replyState.requestedAt) {
    const queuedPrompt = buildReplyStatePrompt(selectedSession, "queued");

    return queuedPrompt &&
      pendingChatPrompt?.text === queuedPrompt.text &&
      pendingChatPrompt?.requestedAt === queuedPrompt.requestedAt &&
      pendingChatPrompt.status === "queued"
      ? { kind: "none" }
      : queuedPrompt
        ? { kind: "set-pending", prompt: queuedPrompt }
        : { kind: "none" };
  }

  if (replyState.phase === "waiting" && replyState.requestedAt) {
    const waitingPrompt = buildReplyStatePrompt(selectedSession, "waiting");

    if (
      waitingPrompt &&
      hasPromptCompletionInTranscript(activeTakenOverAgentSession, waitingPrompt)
    ) {
      return { kind: "clear-completed", prompt: waitingPrompt };
    }

    return { kind: "none" };
  }

  if (pendingChatPrompt) {
    return resolvePendingPromptSyncAction({
      activeTakenOverAgentSession,
      awaitingChatReplySince,
      isWaitingForChatReply,
      pendingChatPrompt,
      selectedSession
    });
  }

  return awaitingChatReplySince || isWaitingForChatReply
    ? { kind: "clear-waiting" }
    : { kind: "none" };
}

export function getCancelledPromptCleanupDelay(prompt: PendingChatPrompt) {
  const requestedAt = new Date(prompt.requestedAt).getTime();
  const elapsedMs = Number.isFinite(requestedAt)
    ? Date.now() - requestedAt
    : CANCELLED_PROMPT_RETENTION_MS;

  return Math.max(0, CANCELLED_PROMPT_RETENTION_MS - elapsedMs);
}
