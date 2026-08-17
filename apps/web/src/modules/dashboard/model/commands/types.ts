import type { MutableRefObject } from "react";

import type { AgentSessionSummary, OverviewResponse, SessionDetail } from "@deskcue/protocol";
import type { PendingChatPrompt } from "@models/promptDelivery";
import type { SessionTab } from "@models/sessionTabs";
import type { LoadOptions } from "@modules/dashboard/model/data/dashboardLoad";

export type PromptDeliveryActions = {
  beginPromptDelivery: (
    text: string,
    status?: PendingChatPrompt["status"],
    target?: Pick<PendingChatPrompt, "sessionId" | "sourceSessionId">
  ) => void;
  markPromptAccepted: (
    text: string,
    target?: Pick<PendingChatPrompt, "sessionId" | "sourceSessionId">,
    requestedAt?: string
  ) => void;
  clearPromptDeliveryState: () => void;
  interruptPromptBeforeSendingReplacement: (
    sessionId: string,
    operation: PromptOperationState
  ) => Promise<boolean>;
  setIsInterruptingPrompt: (value: boolean) => void;
};

export type UseDashboardCommandHandlersArgs = {
  overview: OverviewResponse;
  agentSessions: AgentSessionSummary[];
  workspacePath: string;
  selectedWorkspaceId: string;
  command: string;
  selectedAgentSessionId: string;
  selectedAgentSessionIdRef: MutableRefObject<string>;
  agentAttachOperationRef: MutableRefObject<AgentAttachOperationState>;
  selectedSessionId: string;
  selectedSession: SessionDetail | null;
  selectedSessionIdRef: MutableRefObject<string>;
  selectedSessionSelectionEpochRef: MutableRefObject<number>;
  selectedSessionRef: MutableRefObject<SessionDetail | null>;
  promptOperationRef: MutableRefObject<PromptOperationState>;
  previewPort: string;
  promptDelivery: PromptDeliveryActions;
  setWorkspacePath: (value: string) => void;
  updateOverview: (updater: (current: OverviewResponse) => OverviewResponse) => void;
  setSelectedWorkspaceId: (value: string) => void;
  setSelectedSessionId: (value: string) => void;
  setSelectedSession: (value: SessionDetail | null) => void;
  setActiveTab: (value: SessionTab) => void;
  setError: (value: string) => void;
  setLoading: (value: boolean) => void;
  setPickingWorkspace: (value: boolean) => void;
  setAttachingAgentSessionId: (value: string) => void;
  loadOverview: (options?: LoadOptions) => Promise<OverviewResponse>;
  loadAgentSessions: (options?: LoadOptions) => Promise<AgentSessionSummary[]>;
  loadSession: (sessionId: string, options?: LoadOptions) => Promise<SessionDetail | null>;
};

export type PromptOperationState = {
  epoch: number;
  targetSessionId: string;
};

export type AgentAttachOperationState = {
  epoch: number;
  targetSessionId: string;
};

export type UseDashboardPreviewCommandHandlersArgs = Pick<
  UseDashboardCommandHandlersArgs,
  | "selectedSessionId"
  | "selectedSession"
  | "selectedSessionIdRef"
  | "selectedSessionSelectionEpochRef"
  | "previewPort"
  | "setSelectedSession"
  | "setError"
  | "loadOverview"
>;
