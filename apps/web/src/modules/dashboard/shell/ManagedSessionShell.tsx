import type { SubmitEvent } from "react";

import type {
  AgentTranscriptChangesResponse,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTranscriptSourceRefs,
  PreviewNetworkMode,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import type { PendingChatPrompt, SendInputOptions } from "@models/promptDelivery";
import type { SessionTab } from "@models/sessionTabs";
import { agentChatDetailResource } from "@modules/dashboard/model/chatDetail/resource/agentChatDetailResource";
import { ManagedSessionPanel } from "@modules/session";

export type ManagedSessionShellProps = {
  agentSessions: AgentSessionSummary[];
  managedSessions: SessionSummary[];
  selectedSessionId: string;
  selectedSession: SessionDetail | null;
  takenOverAgentSession: AgentSessionDetail | null;
  agentTranscriptHasMoreById: Map<string, boolean>;
  agentTranscriptHistoryIncompleteById: Map<string, boolean>;
  isTakenOverAgentSessionLoading: boolean;
  liveUpdatesConnection: LiveUpdatesConnectionState;
  activeTab: SessionTab;
  previewPort: string;
  isBootstrapping: boolean;
  sessionLoadError?: string | null;
  pendingChatPrompt: PendingChatPrompt | null;
  isWaitingForChatReply: boolean;
  isInterruptingPrompt: boolean;
  immediateInterruptPrompt: PendingChatPrompt | null;
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
  onInterruptPrompt: () => void;
  onStopSession: () => boolean | Promise<boolean>;
  onStopAndExitSession: () => void | Promise<void>;
  onExitSession: () => void;
  onRefreshGit: () => void;
  onRetrySessionLoad?: () => Promise<unknown>;
  onChangePreviewPort: (value: string) => void;
  onChangePreviewNetworkMode: (value: PreviewNetworkMode) => boolean | Promise<boolean>;
  onSetPreview: (event: SubmitEvent<HTMLFormElement>) => Promise<void>;
  onStopPreview: () => boolean | Promise<boolean>;
  onToggleTools?: (options?: { replace?: boolean }) => void;
};

export function ManagedSessionShell(props: ManagedSessionShellProps) {
  return (
    <ManagedSessionPanel
      {...props}
      activityHydrationRepository={agentChatDetailResource}
      key={props.selectedSessionId}
    />
  );
}
