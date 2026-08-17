import type { PromptRecoveryState } from "@deskcue/protocol";
import { formatChatTime } from "@lib/format";
import type { PendingChatPrompt } from "@models/promptDelivery";
import {
  isInterruptLifecycleUnconfirmed,
  isInterruptLifecycleWaitingSuppressed
} from "@models/sessionInterruptLifecycle";
import type {
  ConversationActivity,
  ConversationTimelineItem
} from "@modules/session/types";

import type {
  BuildManagedSessionChatThreadStateInput,
  ChatThreadOperationState,
  ImmediateInterruptPrompt,
  ManagedSessionChatThreadState,
  TranscriptContentProps
} from "./types";

type PromptIdentity = Pick<PendingChatPrompt, "requestedAt" | "text">;

function getPendingPromptStatusLabel(
  status: PendingChatPrompt["status"] | PromptRecoveryState["phase"] | null | undefined
) {
  switch (status) {
    case "not_confirmed":
      return "Not delivered";
    case "cancelled":
      return "Cancelled";
    case "checking":
      return "Checking delivery";
    case "outcome_unknown":
      return "Delivery unknown";
    case "not_sent":
      return "Not sent";
    case "queued":
      return "Queued";
    case "starting":
      return "Starting agent...";
    default:
      return "Waiting";
  }
}

function buildRecoveryOperation(
  recovery: PromptRecoveryState
): ChatThreadOperationState {
  const hasPromptText = Boolean(recovery.promptText?.trim());
  const actionLabel =
    recovery.phase === "outcome_unknown" && hasPromptText
      ? "Send again anyway"
      : recovery.phase === "not_sent" && recovery.retryable && hasPromptText
        ? "Retry prompt"
        : null;

  if (recovery.phase === "checking") {
    return {
      kind: "recovery",
      actionLabel,
      detail: "DeskCue restarted during delivery. The agent may still be running in the background.",
      identity: `${recovery.requestedAt}:${recovery.promptText ?? ""}`,
      title: "Checking agent history"
    };
  }

  if (recovery.phase === "outcome_unknown") {
    return {
      kind: "recovery",
      actionLabel,
      detail: "The agent may have continued in the background. DeskCue will not resend this prompt automatically.",
      identity: `${recovery.requestedAt}:${recovery.promptText ?? ""}`,
      title: "Delivery outcome unknown"
    };
  }

  return {
    kind: "recovery",
    actionLabel,
    detail: "DeskCue confirmed that the agent did not receive this prompt.",
    identity: `${recovery.requestedAt}:${recovery.promptText ?? ""}`,
    title: "Prompt was not sent"
  };
}

function buildChatThreadOperation(
  input: BuildManagedSessionChatThreadStateInput,
  isStoppingPrompt: boolean
): ChatThreadOperationState {
  if (isStoppingPrompt) return { kind: "stopping" };
  if (isInterruptLifecycleUnconfirmed(input.interruptLifecycle)) return { kind: "interrupt-unconfirmed" };
  if (input.promptRecovery) return buildRecoveryOperation(input.promptRecovery);

  const isPromptQueued = input.pendingChatPrompt?.status === "queued";
  if (
    input.waiting.kind === "idle" ||
    isPromptQueued ||
    isInterruptLifecycleWaitingSuppressed(input.interruptLifecycle)
  ) return { kind: "idle" };

  return {
    kind: "waiting",
    detailEntry: input.waiting.detailEntry,
    source: input.waiting.kind
  };
}

export function areTranscriptContentPropsEqual(
  previous: TranscriptContentProps,
  next: TranscriptContentProps
) {
  return previous.entry === next.entry &&
    previous.collapseSecondaryParts === next.collapseSecondaryParts &&
    previous.assetContext?.agentSessionId === next.assetContext?.agentSessionId &&
    previous.assetContext?.managedSessionId === next.assetContext?.managedSessionId;
}

export function hasVisibleConfirmedPrompt(
  visibleConversationTimeline: ConversationTimelineItem[],
  pendingChatPrompt: PromptIdentity | null
) {
  if (!pendingChatPrompt) return false;

  const promptText = pendingChatPrompt.text.trim();
  const requestedAt = new Date(pendingChatPrompt.requestedAt).getTime();

  return visibleConversationTimeline.some((item) => {
    if (item.type !== "message" || item.role !== "user") return false;

    if (item.entry.text.trim() !== promptText) return false;

    const entryTime = new Date(item.timestamp).getTime();
    return !Number.isFinite(requestedAt) || entryTime >= requestedAt - 15_000;
  });
}

export function findImmediateInterruptTargetKey(
  items: ConversationTimelineItem[],
  prompt: ImmediateInterruptPrompt | null
) {
  if (!prompt) return null;

  const normalizedPromptText = prompt.text.trim();
  if (!normalizedPromptText) return null;

  const requestedAt = new Date(prompt.requestedAt).getTime();
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const itemTime = item.type === "message" ? new Date(item.timestamp).getTime() : Number.NaN;
    if (
      item.type === "message" &&
      item.role === "user" &&
      item.entry.text.trim() === normalizedPromptText &&
      (!Number.isFinite(requestedAt) ||
        (Number.isFinite(itemTime) && itemTime >= requestedAt - 15_000))
    ) {
      return item.key;
    }
  }

  return null;
}

export function buildManagedSessionChatThreadState(
  input: BuildManagedSessionChatThreadStateInput
): ManagedSessionChatThreadState {
  if (input.shouldShowChatLoading) return { kind: "loading" };

  const isStoppingPrompt =
    input.isInterruptingPrompt || input.interruptLifecycle.phase === "requested";
  const immediateInterruptTargetKey = findImmediateInterruptTargetKey(
    input.visibleConversationTimeline,
    input.immediateInterruptPrompt
  );
  const shouldRenderImmediateInterruptPrompt =
    Boolean(input.immediateInterruptPrompt) && !immediateInterruptTargetKey;
  const renderedPendingPrompt = shouldRenderImmediateInterruptPrompt
    ? input.immediateInterruptPrompt
    : input.pendingChatPrompt ?? (
        input.promptRecovery?.promptText?.trim()
          ? {
              text: input.promptRecovery.promptText,
              requestedAt: input.promptRecovery.requestedAt
            }
          : null
      );
  const renderedPendingPromptStatus = shouldRenderImmediateInterruptPrompt
    ? null
    : input.pendingChatPrompt?.status ?? input.promptRecovery?.phase;
  const shouldRenderPendingPrompt =
    Boolean(renderedPendingPrompt) &&
    (shouldRenderImmediateInterruptPrompt ||
      !hasVisibleConfirmedPrompt(input.visibleConversationTimeline, renderedPendingPrompt));
  const pendingPrompt = shouldRenderPendingPrompt && renderedPendingPrompt
    ? {
        requestedAt: renderedPendingPrompt.requestedAt,
        statusLabel: shouldRenderImmediateInterruptPrompt
          ? formatChatTime(renderedPendingPrompt.requestedAt)
          : getPendingPromptStatusLabel(renderedPendingPromptStatus),
        text: renderedPendingPrompt.text,
        turnStatus:
          shouldRenderImmediateInterruptPrompt && input.immediateInterruptPrompt
            ? {
                label: input.immediateInterruptPrompt.phase === "stopping"
                  ? "Stopping"
                  : "Interrupted",
                title: input.immediateInterruptPrompt.phase === "stopping"
                  ? "DeskCue is stopping this prompt"
                  : "DeskCue interrupted this prompt; waiting for the source transcript to confirm"
              }
            : null
      }
    : null;
  const timeline = immediateInterruptTargetKey && input.immediateInterruptPrompt
    ? input.visibleConversationTimeline.map((item) =>
        item.type === "message" &&
        item.key === immediateInterruptTargetKey &&
        !item.turnStatus
          ? {
              ...item,
              turnStatus: {
                kind: "interrupted" as const,
                label: input.immediateInterruptPrompt?.phase === "stopping"
                  ? "Stopping"
                  : "Interrupted",
                title: input.immediateInterruptPrompt?.phase === "stopping"
                  ? "DeskCue is stopping this prompt"
                  : "DeskCue interrupted this prompt; waiting for the source transcript to confirm"
              }
            }
          : item
      )
    : input.visibleConversationTimeline;
  const operation = buildChatThreadOperation(input, isStoppingPrompt);
  const hasLiveConversationState =
    input.hasConversationContent ||
    timeline.length > 0 ||
    Boolean(pendingPrompt) ||
    operation.kind !== "idle";
  if (!hasLiveConversationState) return { kind: "empty" };

  return {
    kind: "ready",
    operation,
    pendingPrompt,
    timeline
  };
}

export function getLifecycleActivityDetail(activity: ConversationActivity) {
  for (const entry of activity.entries) {
    const statusPart = entry.parts?.find(
      (part) => part.type === "status" && part.detail
    );

    if (statusPart?.type === "status") return statusPart.detail;
  }

  return null;
}
