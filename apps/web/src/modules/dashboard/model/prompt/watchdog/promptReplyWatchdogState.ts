import type { AgentSessionDetail, SessionDetail } from "@deskcue/protocol";
import {
  hasPromptCompletionInTranscript,
  hasPromptConfirmationInTranscript
} from "@models/promptDelivery";
import type { PendingChatPrompt } from "@models/promptDelivery";
import {
  PROMPT_REPLY_WATCHDOG_TERMINAL_GRACE_MS
} from "@modules/dashboard/model/prompt/constants";

export type PromptWatch = {
  agentSessionId: string;
  graceDeadline: number;
  hardDeadline: number;
  key: string;
  managedPromptActive: boolean;
  managedSessionId: string;
  observedCurrentSourceActive: boolean;
  observedSourceTerminal: boolean;
  prompt: PendingChatPrompt;
  sourcePromptActive: boolean;
  sourceSessionId: string | null;
  stopped: boolean;
};

export function isManagedReplyActive(
  phase: SessionDetail["replyState"]["phase"] | undefined
) {
  return phase === "sending" || phase === "waiting";
}

export function isSourceTurnActive(session: AgentSessionDetail) {
  return session.turnState?.phase === "active" || session.workState === "running";
}

export function isSourceTurnTerminal(session: AgentSessionDetail) {
  const phase = session.turnState?.phase;

  return phase === "completed" || phase === "failed" || phase === "interrupted";
}

export function buildPromptKey(
  prompt: PendingChatPrompt,
  agentSessionId: string,
  sourceSessionId: string | null
) {
  return [
    prompt.sessionId,
    sourceSessionId ?? "",
    agentSessionId,
    prompt.requestedAt,
    prompt.text
  ].join("\u0000");
}

export function extendTranscriptGrace(watch: PromptWatch, now: number) {
  watch.graceDeadline = Math.max(
    watch.graceDeadline,
    now + PROMPT_REPLY_WATCHDOG_TERMINAL_GRACE_MS
  );
}

export function canPoll(watch: PromptWatch, now: number) {
  if (watch.stopped || now >= watch.hardDeadline) return false;

  return watch.managedPromptActive ||
    watch.sourcePromptActive ||
    now < watch.graceDeadline;
}

export function getNextPollDelay(
  watch: PromptWatch,
  now: number,
  preferredDelay: number
) {
  const activeDeadline = watch.managedPromptActive || watch.sourcePromptActive
    ? watch.hardDeadline
    : Math.min(watch.graceDeadline, watch.hardDeadline);
  return Math.min(preferredDelay, Math.max(0, activeDeadline - now));
}

export function observePromptReply(
  watch: PromptWatch,
  session: AgentSessionDetail,
  now: number
) {
  const hasCurrentPromptEvidence = hasPromptConfirmationInTranscript(
    session,
    watch.prompt
  );
  const sourceTurnActive = isSourceTurnActive(session);

  if (sourceTurnActive && hasCurrentPromptEvidence) watch.observedCurrentSourceActive = true;

  watch.sourcePromptActive = sourceTurnActive &&
    (hasCurrentPromptEvidence || watch.observedCurrentSourceActive);

  const sourceTurnTerminal = isSourceTurnTerminal(session) &&
    (hasCurrentPromptEvidence || watch.observedCurrentSourceActive);

  if (sourceTurnTerminal && !watch.observedSourceTerminal) {
    watch.observedSourceTerminal = true;
    watch.sourcePromptActive = false;
    extendTranscriptGrace(watch, now);
  }

  return hasCurrentPromptEvidence &&
    hasPromptCompletionInTranscript(session, watch.prompt);
}
