import type { ReactNode, RefObject } from "react";

import type { PromptRecoveryState } from "@deskcue/protocol";
import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";
import type { PendingChatPrompt } from "@models/promptDelivery";
import type { SessionInterruptLifecycle } from "@models/sessionInterruptLifecycle";
import type {
  ChatTranscriptEntry,
  ConversationActivity,
  ConversationTimelineItem
} from "@modules/session/types";

export type CopyFeedback = {
  messageId: string;
  status: "copied" | "failed";
} | null;

/**
 * A short-lived, client-side presentation of a DeskCue-owned interrupt.
 *
 * The source transcript remains authoritative for the eventual status. This
 * marker only prevents the user prompt from briefly losing its lifecycle
 * state while the interrupt response and transcript refresh cross in flight.
 */
export type ImmediateInterruptPrompt = {
  text: string;
  requestedAt: string;
  phase: "stopping" | "interrupted";
};

export type ChatThreadPendingPrompt = {
  requestedAt: string;
  statusLabel: string;
  text: string;
  turnStatus: {
    label: string;
    title: string;
  } | null;
};

export type ChatThreadOperationState =
  | { kind: "idle" }
  | { kind: "stopping" }
  | { kind: "interrupt-unconfirmed" }
  | {
      kind: "recovery";
      actionLabel: "Retry prompt" | "Send again anyway" | null;
      detail: string;
      identity: string;
      title: string;
    }
  | {
      kind: "waiting";
      detailEntry: ChatTranscriptEntry | null;
      source: "deskcue" | "external";
    };

export type ManagedSessionChatThreadState =
  | { kind: "loading" }
  | { kind: "empty" }
  | {
      kind: "ready";
      operation: ChatThreadOperationState;
      pendingPrompt: ChatThreadPendingPrompt | null;
      timeline: ConversationTimelineItem[];
    };

export type BuildManagedSessionChatThreadStateInput = {
  hasConversationContent: boolean;
  immediateInterruptPrompt: ImmediateInterruptPrompt | null;
  interruptLifecycle: SessionInterruptLifecycle;
  isInterruptingPrompt: boolean;
  pendingChatPrompt: PendingChatPrompt | null;
  promptRecovery: PromptRecoveryState | null;
  shouldShowChatLoading: boolean;
  visibleConversationTimeline: ConversationTimelineItem[];
  waiting:
    | { kind: "idle" }
    | { kind: "deskcue"; detailEntry: ChatTranscriptEntry | null }
    | { kind: "external"; detailEntry: ChatTranscriptEntry | null };
};

export type ManagedSessionChatThreadProps = {
  assistantDisplayName: string;
  assetContext?: LocalAssetLinkContext;
  canRevealEarlierHistory: boolean;
  copyFeedback: CopyFeedback;
  hiddenConversationItemCount: number;
  isLoadingMoreHistory: boolean;
  showScrollToLatest: boolean;
  state: ManagedSessionChatThreadState;
  threadRef: RefObject<HTMLDivElement | null>;
  isActivityExpanded: (activity: ConversationActivity) => boolean;
  renderActivityEntries: (activity: ConversationActivity) => ReactNode;
  onCopyMessage: (messageId: string, text: string) => void;
  onHydrateActivityGroup: (activity: ConversationActivity) => void;
  onRevealEarlierHistory: () => void;
  onRetryRecoveredPrompt: () => Promise<boolean>;
  onScrollToLatest: () => void;
  onToggleActivityGroup: (activity: ConversationActivity) => void;
};

export type ConversationMessageItem = Extract<ConversationTimelineItem, { type: "message" }>;

export type ChatThreadMessageProps = Pick<
  ManagedSessionChatThreadProps,
  | "assistantDisplayName"
  | "assetContext"
  | "copyFeedback"
  | "isActivityExpanded"
  | "onHydrateActivityGroup"
  | "onCopyMessage"
  | "onToggleActivityGroup"
  | "renderActivityEntries"
> & {
  item: ConversationMessageItem;
};

export type TranscriptContentProps = {
  assetContext?: ManagedSessionChatThreadProps["assetContext"];
  collapseSecondaryParts?: boolean;
  entry: ChatTranscriptEntry | {
    text: string;
    parts?: ChatTranscriptEntry["parts"];
  };
};
