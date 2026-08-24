import type {
  AgentSessionDetail,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import { isActiveSourceTurn } from "@models/agentChatWorkState";
import {
  hasPromptCompletionInTranscript
} from "@models/promptDelivery";
import type { PendingChatPrompt } from "@models/promptDelivery";
import {
  hasPendingPromptSourceSessionId,
  isLocalAgentStartupVisible,
  isPendingPromptForSession
} from "@modules/session/helpers";
import type { ChatTranscriptEntry } from "@modules/session/types";

type SessionShell = SessionDetail | SessionSummary | null;

export function isManagedSourceSessionWorking(
  sessionShell: SessionShell,
  sourceSession: AgentSessionDetail | null
) {
  const canSurfaceSourceWork =
    sessionShell?.status === "running" || sessionShell?.status === "read_only";

  return Boolean(sessionShell?.sourceSessionId) &&
    canSurfaceSourceWork &&
    isActiveSourceTurn(sourceSession);
}

export function buildPromptIdentity(prompt: PendingChatPrompt) {
  return `${prompt.requestedAt}:${prompt.text}`;
}

function findLastUserPromptIndex(
  chatTranscriptEntries: ChatTranscriptEntry[],
  promptText: string
) {
  const normalizedPromptText = promptText.trim();

  for (let index = chatTranscriptEntries.length - 1; index >= 0; index -= 1) {
    const entry = chatTranscriptEntries[index];

    if (entry.role === "user" && entry.text.trim() === normalizedPromptText) return index;
  }

  return -1;
}

function chooseOwnedPrompt(
  clientPrompt: PendingChatPrompt | null,
  shellPrompt: PendingChatPrompt | null,
  chatTranscriptEntries: ChatTranscriptEntry[]
) {
  if (!clientPrompt || !shellPrompt) return clientPrompt ?? shellPrompt;

  if (buildPromptIdentity(clientPrompt) === buildPromptIdentity(shellPrompt)) {
    // The server-confirmed phase is authoritative for the same turn.
    return shellPrompt;
  }

  if (
    clientPrompt.status === "starting" ||
    clientPrompt.status === "sending" ||
    clientPrompt.status === "queued"
  ) {
    // This browser has just submitted a prompt that the shell can legitimately
    // lag behind. Do not compare browser and daemon wall clocks: DeskCue is
    // commonly opened from a different device.
    return clientPrompt;
  }

  const clientTranscriptIndex = findLastUserPromptIndex(
    chatTranscriptEntries,
    clientPrompt.text
  );
  const shellTranscriptIndex = findLastUserPromptIndex(
    chatTranscriptEntries,
    shellPrompt.text
  );

  if (clientTranscriptIndex > shellTranscriptIndex) return clientPrompt;

  // Once the local prompt is no longer in its submission phase, the daemon
  // shell is authoritative unless transcript order proves the client prompt
  // is the later turn.
  return shellPrompt;
}

export function isRunningSourceSessionPrompt(
  session: { sourceSessionId?: string | null; status?: string } | null | undefined
) {
  return Boolean(session?.sourceSessionId) && session?.status === "running";
}

export function isConfirmedDeskCuePendingPrompt(prompt: PendingChatPrompt | null) {
  return Boolean(prompt && prompt.status !== "not_confirmed");
}

export function resolvePendingChatPrompt({
  chatTranscriptEntries,
  isPromptTrackableSessionShell,
  pendingChatPrompt,
  selectedSessionDetail,
  selectedSessionId,
  sessionShell
}: {
  chatTranscriptEntries: ChatTranscriptEntry[];
  isPromptTrackableSessionShell: boolean;
  pendingChatPrompt: PendingChatPrompt | null;
  selectedSessionDetail: SessionDetail | null;
  selectedSessionId: string;
  sessionShell: SessionShell;
}) {
  const scopedPendingChatPrompt =
    isPendingPromptForSession(pendingChatPrompt, selectedSessionId, sessionShell?.sourceSessionId ?? null)
      ? pendingChatPrompt
      : null;
  const shellReplyStatePrompt =
    sessionShell?.sourceSessionId &&
    isPromptTrackableSessionShell &&
    (sessionShell.replyState.phase === "queued" ||
      sessionShell.replyState.phase === "sending" ||
      sessionShell.replyState.phase === "waiting") &&
    sessionShell.replyState.promptText &&
    sessionShell.replyState.requestedAt
      ? {
          text: sessionShell.replyState.promptText,
          requestedAt: sessionShell.replyState.requestedAt,
          status: sessionShell.replyState.phase
        }
      : null;
  const candidatePendingChatPrompt =
    chooseOwnedPrompt(
      scopedPendingChatPrompt,
      shellReplyStatePrompt,
      chatTranscriptEntries
    );
  const rawPendingChatPrompt = candidatePendingChatPrompt;
  const isRawPendingPromptCompleted =
    rawPendingChatPrompt &&
    hasPromptCompletionInTranscript({ transcript: chatTranscriptEntries }, rawPendingChatPrompt);
  const effectivePendingChatPrompt =
    rawPendingChatPrompt && isRawPendingPromptCompleted ? null : rawPendingChatPrompt;
  const isStartingLocalAgent =
    effectivePendingChatPrompt?.status === "sending" &&
    !isRunningSourceSessionPrompt(sessionShell) &&
    isLocalAgentStartupVisible(selectedSessionDetail, effectivePendingChatPrompt.requestedAt);
  const displayedPendingChatPrompt =
    isStartingLocalAgent && effectivePendingChatPrompt
      ? {
          ...effectivePendingChatPrompt,
          status: "starting" as const
        }
      : effectivePendingChatPrompt &&
          (hasPendingPromptSourceSessionId(effectivePendingChatPrompt) || sessionShell?.sourceSessionId)
        ? {
            ...effectivePendingChatPrompt,
            status:
              effectivePendingChatPrompt.status === "not_confirmed" ||
              effectivePendingChatPrompt.status === "queued"
                ? effectivePendingChatPrompt.status
                : ("waiting" as const)
          }
        : effectivePendingChatPrompt;

  return {
    displayedPendingChatPrompt,
    effectivePendingChatPrompt,
    isRawPendingPromptCompleted: Boolean(isRawPendingPromptCompleted),
    rawPendingChatPrompt
  };
}

export function resolveShellWaitingPrompt({
  isPromptTrackableSessionShell,
  sessionShell
}: {
  isPromptTrackableSessionShell: boolean;
  sessionShell: SessionShell;
}) {
  const shellWaitingPrompt =
    sessionShell?.sourceSessionId &&
    isPromptTrackableSessionShell &&
    sessionShell.replyState.phase === "waiting" &&
    sessionShell.replyState.promptText &&
    sessionShell.replyState.requestedAt
      ? {
          text: sessionShell.replyState.promptText,
          requestedAt: sessionShell.replyState.requestedAt,
          status: "waiting" as const
        }
      : null;
  return shellWaitingPrompt;
}

export function hasShellWaitingPromptCompleted(
  takenOverAgentSession: AgentSessionDetail | null,
  effectiveShellWaitingPrompt: PendingChatPrompt | null
) {
  return effectiveShellWaitingPrompt
    ? hasPromptCompletionInTranscript(takenOverAgentSession, effectiveShellWaitingPrompt)
    : false;
}

export function hasAssistantReplyAfterPrompt(
  chatTranscriptEntries: ChatTranscriptEntry[],
  prompt: PendingChatPrompt
) {
  const requestedAt = new Date(prompt.requestedAt).getTime();
  const promptText = prompt.text.trim();
  let promptTime = Number.isFinite(requestedAt) ? requestedAt : 0;

  for (const entry of chatTranscriptEntries) {
    if (entry.role !== "user" || entry.text.trim() !== promptText) continue;

    const entryTime = new Date(entry.timestamp).getTime();

    if (Number.isFinite(entryTime) && entryTime >= promptTime - 15_000) promptTime = entryTime;
  }

  return chatTranscriptEntries.some((entry) => {
    const entryTime = new Date(entry.timestamp).getTime();

    return entry.role === "assistant" && Number.isFinite(entryTime) && entryTime >= promptTime;
  });
}

export function resolveInputAvailability(
  sessionShell: SessionShell,
  options: {
    blockExternalSourceInput?: boolean;
    canSendInputWhenReadOnly?: boolean;
  } = {}
) {
  const canResumeAdapterSession =
    Boolean(sessionShell?.sourceSessionId) &&
    (sessionShell?.status === "done" ||
      sessionShell?.status === "read_only" ||
      sessionShell?.status === "stopped") &&
    sessionShell?.canSendInput === true;
  const canSendOwnedReadOnlyInput =
    options.canSendInputWhenReadOnly === true &&
    sessionShell?.status === "read_only";

  const canSendInput = !options.blockExternalSourceInput && (
    canSendOwnedReadOnlyInput ||
    canResumeAdapterSession ||
    (Boolean(sessionShell?.sourceSessionId) &&
      sessionShell?.status === "running" &&
      sessionShell.canSendInput !== false) ||
    (sessionShell?.status === "running" && sessionShell.canSendInput !== false)
  );

  return {
    canSendInput
  };
}

export function resolvePromptInFlight({
  hasActivePendingPrompt,
  isInterruptingPrompt,
  isSourceSessionWorking,
  isWaitingForChatReply,
  suppressWaitingForInterruptLifecycle
}: {
  hasActivePendingPrompt: boolean;
  isInterruptingPrompt: boolean;
  isSourceSessionWorking: boolean;
  isWaitingForChatReply: boolean;
  suppressWaitingForInterruptLifecycle: boolean;
}) {
  return !suppressWaitingForInterruptLifecycle && (
    hasActivePendingPrompt ||
    isWaitingForChatReply ||
    isInterruptingPrompt ||
    isSourceSessionWorking
  );
}

export function shouldShowManagedSessionChatLoading({
  hasConversationContent,
  hasPendingPrompt,
  isInterruptingPrompt,
  isSessionShellLoading,
  isTranscriptLoading,
  isTranscriptSyncing,
  isWaitingForChatReply,
  suppressWaitingForInterruptLifecycle
}: {
  hasConversationContent: boolean;
  hasPendingPrompt: boolean;
  isInterruptingPrompt: boolean;
  isSessionShellLoading: boolean;
  isTranscriptLoading: boolean;
  isTranscriptSyncing: boolean;
  isWaitingForChatReply: boolean;
  suppressWaitingForInterruptLifecycle: boolean;
}) {
  // A durable pending prompt is restored before the source transcript after a
  // page reload. Keep the transcript skeleton visible until that initial load
  // finishes instead of briefly rendering the prompt as the entire history.
  if (isTranscriptLoading && !hasConversationContent) return true;

  return (
    (isSessionShellLoading || isTranscriptSyncing) &&
    !hasConversationContent &&
    !hasPendingPrompt &&
    !isWaitingForChatReply &&
    !isInterruptingPrompt &&
    !suppressWaitingForInterruptLifecycle
  );
}
