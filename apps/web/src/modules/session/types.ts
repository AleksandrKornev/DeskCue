import type { FormEvent, PropsWithChildren, ReactNode } from "react";

import type {
  AgentTranscriptChangesResponse,
  AgentSessionSummary,
  AgentSessionDetail,
  AgentTranscriptSourceRefs,
  PreviewNetworkMode,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import type { PendingChatPrompt, SendInputOptions } from "@models/promptDelivery";
import type { SessionTab } from "@models/sessionTabs";

export interface ManagedSessionPanelProps {
  activityHydrationRepository?: ManagedSessionActivityHydrationRepository;
  agentSessions: AgentSessionSummary[];
  managedSessions: SessionSummary[];
  selectedSessionId: string;
  selectedSession: SessionDetail | null;
  takenOverAgentSession: AgentSessionDetail | null;
  agentTranscriptHasMoreById: Map<string, boolean>;
  isTakenOverAgentSessionLoading: boolean;
  liveUpdatesConnection: LiveUpdatesConnectionState;
  activeTab: SessionTab;
  previewPort: string;
  isBootstrapping: boolean;
  sessionLoadError?: string | null;
  pendingChatPrompt: PendingChatPrompt | null;
  isWaitingForChatReply: boolean;
  isInterruptingPrompt: boolean;
  immediateInterruptPrompt?: PendingChatPrompt | null;
  /**
   * Keeps the ordinary read-only source-session policy intact while allowing
   * a DeskCue-owned conversation to accept its next prompt from the same UI.
   */
  canSendInputWhenReadOnly?: boolean;
  suppressExternalWaiting?: boolean;
  headerMenuItem?: ReactNode;
  headerMetaItem?: ReactNode;
  chatComposerSupplement?: ReactNode;
  hideChatComposer?: boolean;
  hasWorkspaceFiles?: boolean;
  hasPreview?: boolean;
  showTools?: boolean;
  onSelectSession: (sessionId: string) => void;
  onSelectTab: (tab: SessionTab) => void;
  onSendInput: (instruction: string, options?: SendInputOptions) => Promise<boolean>;
  onHydrateAgentSessionTranscriptEntries: (
    agentSessionId: string,
    entryIds: string[]
  ) => Promise<AgentSessionDetail["transcript"]>;
  onHydrateAgentSessionChanges: (
    agentSessionId: string,
    groupId: string,
    sourceRefs?: AgentTranscriptSourceRefs
  ) => Promise<AgentTranscriptChangesResponse>;
  onLoadMoreAgentSessionTranscript: (agentSessionId: string, beforeEntryId: string) => Promise<number>;
  onInterruptPrompt: () => void | Promise<void>;
  onStopSession: () => boolean | Promise<boolean>;
  onStopAndExitSession: () => void | Promise<void>;
  onExitSession: () => void;
  onRefreshGit: () => void;
  onRetrySessionLoad?: () => Promise<unknown>;
  onChangePreviewPort: (value: string) => void;
  onChangePreviewNetworkMode: (value: PreviewNetworkMode) => boolean | Promise<boolean>;
  onSetPreview: (event: FormEvent<HTMLFormElement>) => void;
  onStopPreview: () => boolean | Promise<boolean>;
  onToggleTools?: () => void;
}

export type ManagedSessionSurfaceProps = PropsWithChildren<{
  sessionShell: SessionDetail | SessionSummary;
}>;

export interface ManagedSessionActivityHydrationRepository {
  hasFailedChanges: (
    agentSessionId: string,
    groupId: string,
    sourceRefs?: AgentTranscriptSourceRefs
  ) => boolean;
  hasFailedTranscriptEntry: (agentSessionId: string, entryId: string) => boolean;
  hasFailedTranscriptEntries: (agentSessionId: string, entryIds: string[]) => boolean;
  readHydratedChanges: (
    agentSessionId: string,
    groupId: string,
    sourceRefs?: AgentTranscriptSourceRefs
  ) => AgentTranscriptChangesResponse | null;
  readHydratedTranscriptEntries: (
    agentSessionId: string,
    entryIds: string[]
  ) => AgentSessionDetail["transcript"];
  readHydratedTranscriptEntry: (
    agentSessionId: string,
    entryId: string
  ) => AgentSessionDetail["transcript"][number] | null;
}

export type ChatTranscriptEntry = AgentSessionDetail["transcript"][number];

export interface ConversationActivity {
  id: string;
  kind: "changes" | "context" | "model" | "tools" | "details";
  label: string;
  timestamp: string;
  entries: ChatTranscriptEntry[];
  entryIds?: string[];
  sourceEntryIds?: string[];
  sourceEntryRanges?: AgentTranscriptSourceRefs["sourceEntryRanges"];
  sourceEntrySpans?: AgentTranscriptSourceRefs["sourceEntrySpans"];
  sourceEntryCount?: number;
}

export type ConversationContentItem =
  | {
      id: string;
      type: "entry";
      entry: ChatTranscriptEntry;
      activities: ConversationActivity[];
    }
  | {
      id: string;
      type: "activity";
      activity: ConversationActivity;
    };

export type ConversationEntryItem = Extract<ConversationContentItem, { type: "entry" }>;

export type ConversationTimelineItem =
  | { type: "day"; key: string; label: string }
  | {
      type: "message";
      key: string;
      role: "user" | "assistant";
      timestamp: string;
      continued: boolean;
      entry: ChatTranscriptEntry;
      activities: ConversationActivity[];
      changeActivities: ConversationActivity[];
      turnStatus: {
        kind: "failed" | "incomplete" | "interrupted" | "superseded";
        label: string;
        title: string;
      } | null;
    }
  | {
      type: "activity";
      key: string;
      activity: ConversationActivity;
    };
