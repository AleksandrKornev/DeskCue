import type { ReactNode } from "react";

import type {
  AgentKind,
  AgentSessionDetail,
  AgentSessionSummary,
  LocalLlmChatSummary,
  RuntimeSummary,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import type { AgentSessionsLoadState } from "@models/agentSessions/contracts";
import type { SourceCard } from "@models/dashboard/sourceCards";
import type { PendingChatPrompt } from "@models/promptDelivery";
import type { AttachedManagedSessionInfo } from "@modules/transcript";

export type { AgentSessionsLoadState } from "@models/agentSessions/contracts";

export interface AgentSessionsPanelProps {
  totalAgentSessionsCount: string;
  agentSessions: AgentSessionSummary[];
  agentSessionsHasMore: boolean;
  agentSessionsLoadState: AgentSessionsLoadState;
  agentSessionsQuery: string | null;
  runtimes: RuntimeSummary[];
  workspaces: WorkspaceSummary[];
  managedSessions: SessionSummary[];
  pendingChatPrompt: PendingChatPrompt | null;
  sourceCards: SourceCard[];
  selectedSourceId: AgentKind | "all";
  selectedAgentSessionId: string;
  selectedAgentSession: AgentSessionDetail | null;
  selectedAgentSessionLoadError: string | null;
  readyForReviewAgentSessionIds: string[];
  isAgentSessionLoading: boolean;
  attaching: boolean;
  attachedManagedSessionId: string | null;
  attachedManagedSessionInfo: AttachedManagedSessionInfo | null;
  defaultCollapsed?: boolean;
  isBootstrapping: boolean;
  secondaryAction?: ReactNode;
  onSelectSource: (sourceId: AgentKind | "all") => void;
  onLoadMoreAgentSessions: (
    query?: string,
    options?: { sourceId?: AgentKind | "all" }
  ) => Promise<AgentSessionSummary[]>;
  onReloadAgentSessions: (options?: { sourceId?: AgentKind | "all" }) => Promise<AgentSessionSummary[]>;
  onRetrySelectedAgentSession: () => void;
  onSearchAgentSessions: (
    query: string,
    options?: { silent?: boolean; sourceId?: AgentKind | "all" }
  ) => Promise<AgentSessionSummary[]>;
  onMarkAgentSessionReviewed: (sessionId: string) => void;
  onSelectAgentSession: (sessionId: string) => void;
  onClearAgentSessionSelection: () => void;
  onAttachAgentSession: () => void;
  onOpenManagedSession: (sessionId: string) => void;
  onOpenLocalLlmChat: (chatId: string) => void;
}

export interface AgentSessionsToolbarProps {
  isSearchLoading: boolean;
  localRuntimeTabs: Array<{
    id: LocalLlmChatSummary["runtimeId"];
    label: string;
    sessionCount: number;
  }>;
  query: string;
  selectedLocalRuntime: LocalLlmChatSummary["runtimeId"] | null;
  selectedSourceId: AgentKind | "all";
  sourceCountsUnavailable?: boolean;
  sourceCards: SourceCard[];
  totalAgentSessionsCount: string;
  onQueryChange: (query: string) => void;
  onSelectLocalRuntime: (runtimeId: LocalLlmChatSummary["runtimeId"]) => void;
  onSelectSource: (sourceId: AgentKind | "all") => void;
}

export interface AgentSessionsListProps {
  canShowFewerSessions: boolean;
  canLoadMoreSessions: boolean;
  hasMoreSessions: boolean;
  filteredSessionsCount: number;
  hiddenSessionsCount: number;
  isLoading: boolean;
  isLoadingMoreSessions: boolean;
  totalSessionsCountLabel: string;
  attachedSourceSessionKeys: ReadonlySet<string>;
  readyForReviewAgentSessionIds: ReadonlySet<string>;
  workIndicatorsBySourceSessionId: ReadonlyMap<string, AgentSessionWorkIndicator>;
  query: string;
  selectedAgentSessionId: string;
  selectedLocalLlmChatId?: string | null;
  sessions: AgentSessionSummary[];
  localLlmChats: LocalLlmChatSummary[];
  showAllLocalLlmChats?: boolean;
  title?: string;
  onSelectAgentSession: (sessionId: string) => void;
  onOpenLocalLlmChat: (chat: LocalLlmChatSummary) => void;
  onShowFewerSessions: () => void;
  onShowMoreSessions: () => void;
}

export interface AgentSessionWorkIndicator {
  label: string;
  tone: "active" | "waiting" | "readonly";
  viewerCount: number;
  sessionId: string;
}

export interface CollapsedAgentSessionsPanelProps {
  selectedAgentSession: AgentSessionDetail | null;
  onExpand: () => void;
}

export interface AgentSessionsEmptyStateProps {
  hasSearchQuery: boolean;
  hasSourceSessions: boolean;
  isUnavailable?: boolean;
  onRetry?: () => void;
}

export interface MobileAgentSessionDetailProps {
  agentSessionId: string;
  agentSessionLabel: string;
  transcriptPanel: ReactNode;
  onBackToChats: (focusOrigin: HTMLElement) => void;
}

export interface AgentSessionsDesktopLayoutProps {
  sessionsList: ReactNode;
  transcriptPanel: ReactNode;
}

export interface AgentSessionsMobileLayoutProps {
  agentSessionId: string;
  agentSessionLabel: string;
  sessionsList: ReactNode;
  showFocusedDetail: boolean;
  transcriptPanel: ReactNode;
  onBackToChats: () => void;
}
