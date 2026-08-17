import type {
  AgentKind,
  AgentSessionDetail,
  AgentSessionSummary,
  RuntimeSummary,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import type { AgentSessionsLoadState } from "@models/agentSessions/contracts";
import type { SourceCard } from "@models/dashboard/sourceCards";
import type { PendingChatPrompt } from "@models/promptDelivery";
import { AgentSessionsPanel } from "@modules/agents";
import type { AttachedManagedSessionInfo } from "@modules/transcript";

export type AgentBrowserShellProps = {
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
  readyForReviewAgentSessionIds: string[];
  isAgentSessionLoading: boolean;
  attaching: boolean;
  attachedManagedSessionId: string | null;
  attachedManagedSessionInfo: AttachedManagedSessionInfo | null;
  defaultCollapsed?: boolean;
  isBootstrapping: boolean;
  onSelectSource: (sourceId: AgentKind | "all") => void;
  onLoadMoreAgentSessions: (
    query?: string,
    options?: { sourceId?: AgentKind | "all" }
  ) => Promise<AgentSessionSummary[]>;
  onReloadAgentSessions: (options?: { sourceId?: AgentKind | "all" }) => Promise<AgentSessionSummary[]>;
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
};

export function AgentBrowserShell(props: AgentBrowserShellProps) {
  return <AgentSessionsPanel {...props} />;
}
