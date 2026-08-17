import type { AgentSessionDetail, SessionDetail, SessionSummary } from "@deskcue/protocol";
import type {
  SessionNavigationCapabilities,
  SessionTab
} from "@models/sessionTabs";

export interface ManualSessionChromeProps {
  activeSelectedSession: SessionDetail | null;
  activeTab: SessionTab;
  navigationCapabilities: SessionNavigationCapabilities;
  navigationIdPrefix: string;
  sessionShell: SessionDetail | SessionSummary;
  takenOverAgentSession: AgentSessionDetail | null;
  onExitSession: () => void;
  onRefreshGit?: () => void;
  onSelectTab: (tab: SessionTab) => void;
  onStopSession: () => void;
}

export interface ManualSessionOverviewProps {
  activeSelectedSession: SessionDetail | null;
}
