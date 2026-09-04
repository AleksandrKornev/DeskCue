import type { ReactNode, RefObject } from "react";

import type {
  AgentSessionSummary,
  SessionStatus,
  SessionSummary
} from "@deskcue/protocol";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import type {
  SessionNavigationCapabilities,
  SessionTab
} from "@models/sessionTabs";

export type LiveConnectionIndicatorProps = {
  className?: string;
  connection: LiveUpdatesConnectionState;
};

export interface LiveSessionActionsProps {
  adapterLabel: string;
  canStopExternalClaudeBackground?: boolean;
  compact?: boolean;
  extraMenuItem?: ReactNode;
  sessionStatus: SessionStatus;
  showTools: boolean;
  onExitSession: () => void;
  onStopExternalClaudeBackground?: () => void;
  onStopSession: () => boolean | Promise<boolean>;
  onStopAndExitSession?: () => void | Promise<void>;
  onToggleModelContext?: () => void;
  onOpenDiagnostics?: () => void;
  onToggleTools?: (options?: { replace?: boolean }) => void;
}

export type LiveSessionHeaderProps = {
  activeTab: SessionTab;
  actions: ReactNode;
  adapterLabel: string;
  agentLabel?: string;
  navigationCapabilities: SessionNavigationCapabilities;
  contextCompactionCount: number;
  exitLabel?: string;
  isAgentChat: boolean;
  liveUpdatesConnection: LiveUpdatesConnectionState;
  metaItem?: ReactNode;
  navigationIdPrefix: string;
  status: SessionSummary["status"];
  statusLabel?: string;
  subtitle: string;
  title: string;
  toolbarRef: RefObject<HTMLDivElement | null>;
  onExitSession: () => void;
  onSelectTab: (tab: SessionTab) => void;
};

export interface ManagedSessionSwitcherProps {
  agentSessions: AgentSessionSummary[];
  managedSessions: SessionSummary[];
  selectedSessionId: string;
  onSelectSession: (sessionId: string) => void;
}
