import type {
  AgentSessionDetail,
  AgentSessionSummary,
  CapturePreviewArtifactPayload,
  CodexSessionDetail,
  CodexSessionSummary,
  CreateSessionInput,
  ExternalClaudeBackgroundStopCapability,
  ExternalForceStopTarget,
  PreviewNetworkMode,
  ServerEvent
} from "@deskcue/protocol";
import type {
  DaemonEventBus,
  ManagedSessionGitRefreshOptions,
  SourceTurnInterruptTarget
} from "#application/ports";
import type { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";

import { StoreBackedSessionBackend } from "./storeBackedSessionBackend.ts";

export class DeskCueStore {
  private constructor(private readonly backend: StoreBackedSessionBackend) {}

  static async create(
    eventBus: DaemonEventBus,
    sqliteContext?: SqliteDatabaseContext
  ) {
    const backend = await StoreBackedSessionBackend.create(eventBus, sqliteContext);

    return new DeskCueStore(backend);
  }

  listWorkspaces() {
    return this.backend.listWorkspaces();
  }

  createWorkspace(workspacePath: string) {
    return this.backend.createWorkspace(workspacePath);
  }

  listSessions() {
    return this.backend.listSessions();
  }

  getSession(sessionId: string) {
    return this.backend.getSession(sessionId);
  }

  startSession(input: CreateSessionInput) {
    return this.backend.startSession(input);
  }

  sendInput(sessionId: string, input: string) {
    return this.backend.sendInput(sessionId, input);
  }

  startQueuedPrompt(sessionId: string) {
    return this.backend.startQueuedPrompt(sessionId);
  }

  markPromptRecoveryOutcomeUnknown(sessionId: string) {
    return this.backend.markPromptRecoveryOutcomeUnknown(sessionId);
  }

  stopSession(sessionId: string) {
    return this.backend.stopSession(sessionId);
  }

  interruptSession(
    sessionId: string,
    sourceTurn?: SourceTurnInterruptTarget | null,
    sourceAgentSession?: AgentSessionDetail | null
  ) {
    return this.backend.interruptSession(sessionId, sourceTurn, sourceAgentSession);
  }

  getExternalClaudeBackgroundStopCapability(
    sessionId: string
  ): Promise<ExternalClaudeBackgroundStopCapability> {
    return this.backend.getExternalClaudeBackgroundStopCapability(sessionId);
  }

  getExternalDesktopInterruptCapability(sessionId: string) {
    return this.backend.getExternalDesktopInterruptCapability(sessionId);
  }

  stopExternalClaudeBackground(sessionId: string) {
    return this.backend.stopExternalClaudeBackground(sessionId);
  }

  interruptExternalDesktopSession(sessionId: string) {
    return this.backend.interruptExternalDesktopSession(sessionId);
  }

  openExternalCodexDesktopChat(sessionId: string) {
    return this.backend.openExternalCodexDesktopChat(sessionId);
  }

  getExternalForceStopCapability(sessionId: string) {
    return this.backend.getExternalForceStopCapability(sessionId);
  }

  forceStopExternalProcess(sessionId: string, target: ExternalForceStopTarget) {
    return this.backend.forceStopExternalProcess(sessionId, target);
  }

  setPreviewPort(sessionId: string, port: number | null, networkMode?: PreviewNetworkMode) {
    return this.backend.setPreviewPort(sessionId, port, networkMode);
  }

  capturePreviewArtifact(sessionId: string, payload: CapturePreviewArtifactPayload) {
    return this.backend.capturePreviewArtifact(sessionId, payload);
  }

  refreshSessionGit(sessionId: string, options?: ManagedSessionGitRefreshOptions) {
    return this.backend.refreshSessionGit(sessionId, options);
  }

  syncReplyStateFromAgentSession(agentSession: AgentSessionDetail) {
    return this.backend.syncReplyStateFromAgentSession(agentSession);
  }

  reconcileAttachedAgentSession<T extends AgentSessionSummary | AgentSessionDetail>(
    agentSession: T
  ) {
    return this.backend.reconcileAttachedAgentSession(agentSession);
  }

  getAttachedAgentSessionStateVersion(
    agentSession: Pick<AgentSessionSummary, "agentId" | "sourceSessionId">
  ) {
    return this.backend.getAttachedAgentSessionStateVersion(agentSession);
  }

  resumeAgentSession(agentSession: AgentSessionSummary, prompt?: string) {
    return this.backend.resumeAgentSession(agentSession, prompt);
  }

  resumeCodexSession(
    codexSession: CodexSessionSummary | CodexSessionDetail,
    prompt?: string
  ) {
    return this.backend.resumeCodexSession(codexSession, prompt);
  }

  publishServerEvent(event: ServerEvent) {
    this.backend.publishServerEvent(event);
  }

  close() {
    return this.backend.close();
  }
}
