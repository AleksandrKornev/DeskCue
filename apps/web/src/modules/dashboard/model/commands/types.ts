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
  setPreviewPort: (value: string) => void;
  promptDelivery: PromptDeliveryActions;
  updateOverview: (updater: (current: OverviewResponse) => OverviewResponse) => void;
  setSelectedWorkspaceId: (value: string) => void;
  setSelectedSessionId: (value: string) => void;
  setSelectedSession: (value: SessionDetail | null) => void;
  setActiveTab: (value: SessionTab) => void;
  setError: (value: string) => void;
  setLoading: (value: boolean) => void;
  setAttachingAgentSessionId: (value: string) => void;
  loadOverview: (options?: LoadOptions) => Promise<OverviewResponse>;
  loadAgentSessions: (options?: LoadOptions) => Promise<AgentSessionSummary[]>;
  loadSession: (sessionId: string, options?: LoadOptions) => Promise<SessionDetail | null>;
};

export type StartSessionHandlerArgs = Pick<
  UseDashboardCommandHandlersArgs,
  | "command"
  | "loadAgentSessions"
  | "loadOverview"
  | "selectedWorkspaceId"
  | "setError"
  | "setLoading"
>;

export type AttachAgentSessionHandlerArgs = Pick<
  UseDashboardCommandHandlersArgs,
  | "agentAttachOperationRef"
  | "loadAgentSessions"
  | "loadSession"
  | "selectedAgentSessionId"
  | "selectedAgentSessionIdRef"
  | "setActiveTab"
  | "setAttachingAgentSessionId"
  | "setError"
  | "setSelectedSession"
  | "setSelectedSessionId"
  | "setSelectedWorkspaceId"
>;

export type StopSessionHandlerArgs = Pick<
  UseDashboardCommandHandlersArgs,
  | "loadOverview"
  | "loadSession"
  | "promptDelivery"
  | "selectedSession"
  | "selectedSessionId"
  | "selectedSessionIdRef"
  | "selectedSessionSelectionEpochRef"
  | "setActiveTab"
  | "setError"
  | "setSelectedSession"
  | "updateOverview"
>;

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
  | "setPreviewPort"
  | "setSelectedSession"
  | "setError"
  | "loadOverview"
>;
