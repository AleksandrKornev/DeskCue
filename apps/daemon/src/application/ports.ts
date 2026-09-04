import type {
  AgentSessionDetail,
  AgentKind,
  AgentSessionSourceVersion,
  AgentSessionsResponse,
  AgentSessionSummary,
  SourceAgentIndexStatsResponse,
  AgentTranscriptEntry,
  CapturePreviewArtifactPayload,
  CodexSessionDetail,
  CodexSessionSummary,
  CreateSessionInput,
  ExternalClaudeBackgroundStopCapability,
  ExternalDesktopInterruptCapability,
  ExternalForceStopTarget,
  ExternalForceStopCapability,
  ManualCommandResult,
  PreviewNetworkMode,
  ServerEvent,
  SessionDetail,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";

export type DaemonEventBus = {
  off?: (eventName: "event", listener: (event: ServerEvent) => void) => unknown;
  on: (eventName: "event", listener: (event: ServerEvent) => void) => unknown;
  publishServerEvent: (event: ServerEvent) => void;
};

export type WorkspaceBackend = {
  createWorkspace: (workspacePath: string) => Promise<WorkspaceSummary>;
  listWorkspaces: () => WorkspaceSummary[];
};

export type ManualCommandRunnerPort = {
  close: () => Promise<void>;
  run: (command: string, cwd: string) => Promise<ManualCommandResult>;
};

export type ManagedSessionBackend = {
  getExternalClaudeBackgroundStopCapability: (
    sessionId: string
  ) => Promise<ExternalClaudeBackgroundStopCapability>;
  getExternalDesktopInterruptCapability: (
    sessionId: string
  ) => Promise<ExternalDesktopInterruptCapability>;
  stopExternalClaudeBackground: (sessionId: string) => Promise<SessionDetail>;
  interruptExternalDesktopSession: (
    sessionId: string,
    sourceTurn?: SourceTurnInterruptTarget | null
  ) => Promise<SessionDetail>;
  openExternalCodexDesktopChat: (sessionId: string) => Promise<void>;
  getExternalForceStopCapability: (sessionId: string) => Promise<ExternalForceStopCapability>;
  forceStopExternalProcess: (
    sessionId: string,
    target: ExternalForceStopTarget,
    sourceTurn?: SourceTurnInterruptTarget | null
  ) => Promise<SessionDetail>;
  getSession: (sessionId: string) => SessionDetail | null;
  interruptSession: (
    sessionId: string,
    sourceTurn?: SourceTurnInterruptTarget | null,
    sourceAgentSession?: AgentSessionDetail | null
  ) => Promise<SessionDetail>;
  listSessions: () => SessionSummary[];
  markPromptRecoveryOutcomeUnknown?: (sessionId: string) => Promise<SessionDetail | null>;
  refreshSessionGit: (
    sessionId: string,
    options?: ManagedSessionGitRefreshOptions
  ) => Promise<SessionDetail>;
  sendInput: (sessionId: string, input: string) => Promise<SessionDetail>;
  startQueuedPrompt: (sessionId: string) => Promise<SessionDetail>;
  setPreviewPort: (
    sessionId: string,
    port: number | null,
    networkMode?: PreviewNetworkMode
  ) => Promise<SessionDetail>;
  capturePreviewArtifact: (
    sessionId: string,
    payload: CapturePreviewArtifactPayload
  ) => Promise<SessionDetail>;
  startSession: (input: CreateSessionInput) => Promise<SessionDetail>;
  stopSession: (sessionId: string) => Promise<SessionDetail>;
  syncReplyStateFromAgentSession: (agentSession: AgentSessionDetail) => SessionDetail | null;
};

export type SourceTurnInterruptTarget = {
  fingerprint: string;
  startedAt: string;
  /**
   * The source user entry for the DeskCue-owned prompt. Keeping it separate
   * from the lifecycle start entry lets transcript projection mark the exact
   * prompt that was stopped instead of whichever earlier turn started last.
   */
  userEntryId?: string;
};

export type ManagedSessionGitRefreshOptions = {
  includeDiff?: boolean;
};

export type SourceAgentLightweightMode = boolean | "exact-ids" | "bounded-exact-ids";

export type SourceAgentSessionDiscovery = {
  readIndexStats: () => SourceAgentIndexStatsResponse;
  getCodexSessionDetail: (sessionId: string) => Promise<CodexSessionDetail | null>;
  getSessionDetail: (
    agentSessionId: string,
    includeLiveMetadata?: boolean,
    transcriptTail?: number,
    chatMessageTail?: number,
    options?: {
      lightweight?: SourceAgentLightweightMode;
    }
  ) => Promise<AgentSessionDetail | null>;
  getSessionVersion: (
    agentSessionId: string,
    includeLiveMetadata?: boolean
  ) => Promise<AgentSessionSourceVersion | null>;
  getSessionDetailForManagedSession: (
    session: SessionSummary,
    transcriptTail?: number,
    chatMessageTail?: number
  ) => Promise<AgentSessionDetail | null>;
  getTranscriptEntries: (
    agentSessionId: string,
    entryIds: string[]
  ) => Promise<AgentTranscriptEntry[]>;
  getTranscriptWindow?: (
    agentSessionId: string,
    options: {
      baseSourceEntryId: string;
      maxLineCount?: number;
      overlapLineCount?: number;
    }
  ) => Promise<AgentTranscriptEntry[] | null>;
  getTranscriptTailWindow?: (
    agentSessionId: string,
    options: {
      chatMessageTail?: number;
    }
  ) => Promise<AgentTranscriptEntry[] | null>;
  getTranscriptPreviousWindow?: (
    agentSessionId: string,
    options: {
      beforeEntryId: string;
    }
  ) => Promise<{ entries: AgentTranscriptEntry[]; hasMore: boolean } | null>;
  listCodexSessions: () => Promise<CodexSessionSummary[]>;
  listRecentSessions: (
    limit: number,
    workspaces: WorkspaceSummary[],
    options?: {
      force?: boolean;
      includeLiveMetadata?: boolean;
    }
  ) => Promise<AgentSessionSummary[]>;
  listRecentSessionPage: (
    limit: number,
    workspaces: WorkspaceSummary[],
    options?: {
      force?: boolean;
      includeSubagents?: boolean;
      includeLiveMetadata?: boolean;
      offset?: number;
      parentSessionId?: string | null;
      query?: string | null;
      sourceId?: AgentKind | null;
    }
  ) => Promise<AgentSessionsResponse>;
};

export type ManagedSourceAgentSessionDiscovery = Pick<
  SourceAgentSessionDiscovery,
  "getSessionDetailForManagedSession"
>;

export type SourceAgentSessionBackend = {
  getAttachedAgentSessionStateVersion: (
    agentSession: Pick<AgentSessionSummary, "agentId" | "sourceSessionId">
  ) => string;
  reconcileAttachedAgentSession: <T extends AgentSessionSummary | AgentSessionDetail>(
    session: T
  ) => T;
  resumeAgentSession: (
    agentSession: AgentSessionSummary,
    prompt?: string
  ) => Promise<SessionDetail>;
  resumeCodexSession: (
    codexSession: CodexSessionSummary | CodexSessionDetail,
    prompt?: string
  ) => Promise<SessionDetail>;
  syncReplyStateFromAgentSession: (agentSession: AgentSessionDetail) => SessionDetail | null;
};

export type AgentSessionReviewStore = {
  decorateSession: <T extends AgentSessionSummary | AgentSessionDetail>(session: T) => T;
  decorateSessions: <T extends AgentSessionSummary | AgentSessionDetail>(sessions: T[]) => T[];
  markReviewed: (agentSessionId: string, reviewedAt?: string) => string;
};
