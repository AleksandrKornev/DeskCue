import type {
  AgentSessionDetail,
  AgentSessionSummary,
  ExternalForceStopTarget,
  CapturePreviewArtifactPayload,
  CodexSessionDetail,
  CodexSessionSummary,
  CreateSessionInput,
  ExternalClaudeBackgroundStopCapability,
  ExternalDesktopInterruptCapability,
  ExternalForceStopCapability,
  GitSnapshot,
  ServerEvent,
  SessionDetail,
  SessionLogLine,
  PreviewNetworkMode,
  SessionStatus,
  WorkspaceSummary
} from "@deskcue/protocol";
import { SourceTurnInterruptLifecycle } from "#agents/sourceTurnInterruptLifecycle";
import type { SourceTurnInterruptTarget } from "#agents/sourceTurnInterruptLifecycle";
import { AppError } from "#application/errors";
import type { DaemonEventBus, ManagedSessionGitRefreshOptions } from "#application/ports";
import { openCodexDesktopThread as openCodexDesktopThreadInHost } from "#infrastructure/externalUrlLauncher";
import {
  resumeClaudeAgentSession,
  resumeCodexAgentSession,
  resumeDiscoveredAgentSession
} from "#sessions/attach/sessionAttachOrchestration";
import {
  refreshManagedSessionGit,
  captureManagedSessionPreviewArtifact,
  setManagedSessionPreviewPort,
  stopRunningSession
} from "#sessions/commands/sessionCommands";
import type { SessionGitPolling } from "#sessions/git/sessionGitPolling";
import { sendSessionInput } from "#sessions/input/sessionPromptDelivery";
import { detachAttachedSession as detachManagedSession } from "#sessions/lifecycle/sessionFinalization";
import { appendSessionLog } from "#sessions/logs/sessionLogAppend";
import type { SessionRunner, SessionRunnerShutdownSurvivor } from "#sessions/process/sessionRunner";
import {
  toSessionSummary,
  withSessionInputCapability
} from "#sessions/projection/sessionProjection";
import { startGenericCliSession } from "#sessions/start/sessionStart";
import type { SessionRepository } from "#sessions/state/sessionRepository";
import { registerWorkspace } from "#workspaces/workspaceRegistration";

import {
  ExternalAgentSessionControl,
  externalAgentSessionRuntime
} from "./externalAgentSessionControl.ts";
import {
  createStoreBackedReadOnlyClaudeSession,
  createStoreBackedReadOnlyCodexSession
} from "./sessionOperations/storeBackedReadOnlySessionCreation.ts";
import { StoreBackedAttachedSessionReconciler } from "./storeBackedAttachedSessionReconciler.ts";
import {
  noOpPromptDeliveryJournal,
  StoreBackedPromptTransportCoordinator
} from "./storeBackedPromptTransportCoordinator.ts";
import type { PromptDeliveryJournal } from "./storeBackedPromptTransportCoordinator.ts";
import { StoreBackedSessionInputCoordinator } from "./storeBackedSessionInputCoordinator.ts";
import { interruptStoreBackedSession } from "./storeBackedSessionInterrupt.ts";
import type { StoreBackedSessionOperationsOptions } from "./storeBackedSessionOperations.types.ts";
import { createStoreBackedSessionCallbackContext } from "../callbacks/storeBackedSessionCallbackContext.ts";
import {
  createCodexSessionCommandCallbacks,
  createSessionAttachCallbacks,
  createSessionCommandCallbacks,
  createSessionFinalizationCallbacks,
  createSessionLogAppendCallbacks,
  createSessionPromptDeliveryCallbacks,
  createSessionStartCallbacks,
  createWorkspaceRegistrationCallbacks
} from "../callbacks/storeBackedSessionCallbacks.ts";
import type {
  StoreBackedSessionCallbackContext,
  StoreBackedSessionLaunchInput
} from "../callbacks/storeBackedSessionCallbacks.ts";
import type { StoreBackedPersistenceController } from "../persistence/storeBackedPersistenceController.ts";
import { launchStoreBackedManagedSession } from "./sessionOperations/storeBackedManagedSessionLaunch.ts";
import { finishStoreBackedSession } from "./sessionOperations/storeBackedSessionFinalization.ts";
import {
  markStoreBackedPromptRecoveryOutcomeUnknown,
  markStoreBackedSessionRecoveryRequiredAfterShutdown
} from "./sessionOperations/storeBackedSessionRecovery.ts";

export class StoreBackedSessionOperations {
  private readonly eventBus: DaemonEventBus;
  private readonly gitPolling: SessionGitPolling;
  private readonly persistence: StoreBackedPersistenceController;
  private readonly repository: SessionRepository;
  private readonly sessionRunner: SessionRunner;
  private readonly sourceTurnInterrupts: SourceTurnInterruptLifecycle;
  private readonly externalAgentSessionControl: ExternalAgentSessionControl;
  private readonly attachedSessionReconciler: StoreBackedAttachedSessionReconciler;
  private readonly promptDeliveries: PromptDeliveryJournal;
  private readonly sessionInput: StoreBackedSessionInputCoordinator;
  private readonly promptTransport: StoreBackedPromptTransportCoordinator;

  constructor({
    eventBus,
    gitPolling,
    persistence,
    promptDeliveries = noOpPromptDeliveryJournal,
    repository,
    sessionRunner,
    sourceTurnInterrupts,
    openCodexDesktopThread = openCodexDesktopThreadInHost
  }: StoreBackedSessionOperationsOptions) {
    this.eventBus = eventBus;
    this.gitPolling = gitPolling;
    this.persistence = persistence;
    this.repository = repository;
    this.sessionRunner = sessionRunner;
    this.sourceTurnInterrupts = sourceTurnInterrupts;
    this.promptDeliveries = promptDeliveries;
    this.externalAgentSessionControl = new ExternalAgentSessionControl({
      appendSystemLog: (sessionId, text) => this.appendLog(sessionId, "system", text),
      getSession: (sessionId) => this.getSession(sessionId),
      hasManagedChild: (sessionId) => this.sessionRunner.hasChild(sessionId),
      openCodexDesktopThread,
      persistState: () => this.persistState(),
      runtime: externalAgentSessionRuntime,
      sourceTurnInterrupts: this.sourceTurnInterrupts,
      updateSession: (sessionId, patch) => this.updateSession(sessionId, patch)
    });
    this.promptTransport = new StoreBackedPromptTransportCoordinator({
      appendLog: (sessionId, stream, text, timestamp) =>
        this.appendLog(sessionId, stream, text, timestamp),
      finishSession: (sessionId, status, exitCode) =>
        this.finishSession(sessionId, status, exitCode),
      getCallbackContext: () => this.callbackContext(),
      getSession: (sessionId) => this.getSession(sessionId),
      gitPolling: this.gitPolling,
      persistState: () => this.persistState(),
      promptDeliveries,
      publishSessionUpdate: (session) =>
        this.emitServerEvent({ type: "session.updated", payload: this.toSummary(session) }),
      repository: this.repository,
      sessionRunner: this.sessionRunner,
      updateSession: (sessionId, patch) => this.updateSession(sessionId, patch)
    });
    this.sessionInput = new StoreBackedSessionInputCoordinator({
      deliverInput: (sessionId, input, lifecycle) =>
        sendSessionInput(
          createSessionPromptDeliveryCallbacks(this.callbackContext()),
          sessionId,
          input,
          lifecycle
        ),
      getSession: (sessionId) => this.getSession(sessionId),
      hasManagedChild: (sessionId) => Boolean(this.sessionRunner.getChild(sessionId)),
      persistState: () => this.persistState(),
      promptDeliveries,
      updateSession: (sessionId, patch) => this.updateSession(sessionId, patch)
    });
    this.attachedSessionReconciler = new StoreBackedAttachedSessionReconciler({
      getCallbackContext: () => this.callbackContext(),
      markPromptObserved: (sessionId) => this.promptTransport.markPromptObserved(sessionId),
      markPromptCompleted: (sessionId) => this.promptTransport.markCompleted(sessionId),
      persistState: () => this.persistState(),
      repository: this.repository,
      sessionRunner: this.sessionRunner,
      sourceTurnInterrupts: this.sourceTurnInterrupts,
      startQueuedPrompt: (session) =>
        this.promptTransport.startQueuedCodexPrompt(session)
    });
  }

  publishServerEvent(event: ServerEvent) { this.emitServerEvent(event); }
  withInputCapability(session: SessionDetail): SessionDetail {
    return withSessionInputCapability(session, (sessionId) => this.sessionRunner.hasChild(sessionId));
  }

  toSummary(session: SessionDetail) { return toSessionSummary(session, (id) => this.sessionRunner.hasChild(id)); }

  async createWorkspace(rawPath: string): Promise<WorkspaceSummary> {
    return registerWorkspace(createWorkspaceRegistrationCallbacks(this.callbackContext()), rawPath);
  }

  async startSession(input: CreateSessionInput) {
    return startGenericCliSession(createSessionStartCallbacks(this.callbackContext()), input);
  }

  async resumeCodexSession(
    codexSession: CodexSessionSummary | CodexSessionDetail,
    prompt?: string
  ): Promise<SessionDetail> {
    return resumeCodexAgentSession(
      createSessionAttachCallbacks(this.callbackContext()),
      codexSession,
      prompt
    );
  }

  async resumeClaudeSession(agentSession: AgentSessionSummary, prompt?: string) {
    return resumeClaudeAgentSession(createSessionAttachCallbacks(this.callbackContext()), agentSession, prompt);
  }

  async resumeAgentSession(agentSession: AgentSessionSummary, prompt?: string) {
    return resumeDiscoveredAgentSession(createSessionAttachCallbacks(this.callbackContext()), agentSession, prompt);
  }

  async refreshSessionGit(sessionId: string, options?: ManagedSessionGitRefreshOptions) {
    return refreshManagedSessionGit(
      createSessionCommandCallbacks(this.callbackContext()),
      sessionId,
      options
    );
  }

  async setPreviewPort(
    sessionId: string,
    port: number | null,
    networkMode?: PreviewNetworkMode
  ) {
    return setManagedSessionPreviewPort(
      createSessionCommandCallbacks(this.callbackContext()),
      sessionId,
      port,
      networkMode
    );
  }

  async capturePreviewArtifact(sessionId: string, payload: CapturePreviewArtifactPayload) {
    return captureManagedSessionPreviewArtifact(
      createSessionCommandCallbacks(this.callbackContext()),
      sessionId,
      payload
    );
  }

  async sendInput(sessionId: string, input: string): Promise<SessionDetail> {
    return this.sessionInput.sendInput(sessionId, input);
  }

  async startQueuedPrompt(sessionId: string): Promise<SessionDetail> {
    const session = this.getSession(sessionId);

    if (!session) throw new AppError("not_found", "Session not found.");

    return this.promptTransport.startQueuedCodexPrompt(session);
  }

  async markPromptRecoveryOutcomeUnknown(sessionId: string) {
    return markStoreBackedPromptRecoveryOutcomeUnknown({
      getSession: (id) => this.getSession(id),
      persistState: () => this.persistState(),
      publishServerEvent: (event) => this.publishServerEvent(event),
      toSummary: (session) => this.toSummary(session),
      updateSession: (id, patch) => this.updateSession(id, patch)
    }, sessionId);
  }

  interruptSession(sessionId: string, sourceTurn?: SourceTurnInterruptTarget | null) {
    return interruptStoreBackedSession({
      cancelQueuedPrompt: (session) =>
        this.promptTransport.cancelQueuedCodexPrompt(session),
      getCodexCallbacks: () => createCodexSessionCommandCallbacks(this.callbackContext()),
      getCommandCallbacks: () => createSessionCommandCallbacks(this.callbackContext()),
      getSession: (id) => this.getSession(id),
      hasManagedChild: (id) => this.sessionRunner.hasChild(id),
      sourceTurnInterrupts: this.sourceTurnInterrupts
    }, sessionId, sourceTurn);
  }

  async getExternalForceStopCapability(sessionId: string): Promise<ExternalForceStopCapability> {
    return this.externalAgentSessionControl.getForceStopCapability(sessionId);
  }

  async getExternalDesktopInterruptCapability(
    sessionId: string
  ): Promise<ExternalDesktopInterruptCapability> {
    return this.externalAgentSessionControl.getDesktopInterruptCapability(sessionId);
  }

  async openExternalCodexDesktopChat(sessionId: string): Promise<void> {
    return this.externalAgentSessionControl.openCodexDesktopChat(sessionId);
  }

  async getExternalClaudeBackgroundStopCapability(
    sessionId: string
  ): Promise<ExternalClaudeBackgroundStopCapability> {
    return this.externalAgentSessionControl.getClaudeBackgroundStopCapability(sessionId);
  }

  async stopExternalClaudeBackground(sessionId: string): Promise<SessionDetail> {
    return this.externalAgentSessionControl.stopClaudeBackground(sessionId);
  }

  async forceStopExternalProcess(
    sessionId: string,
    target: ExternalForceStopTarget,
    sourceTurn?: SourceTurnInterruptTarget | null
  ): Promise<SessionDetail> {
    return this.externalAgentSessionControl.forceStopProcess(sessionId, target, sourceTurn);
  }

  async interruptExternalDesktopSession(
    sessionId: string,
    sourceTurn?: SourceTurnInterruptTarget | null
  ): Promise<SessionDetail> {
    return this.externalAgentSessionControl.interruptDesktopSession(sessionId, sourceTurn);
  }

  async stopSession(sessionId: string) {
    return stopRunningSession(createSessionCommandCallbacks(this.callbackContext()), sessionId);
  }

  syncReplyStateFromAgentSession(agentSession: AgentSessionDetail) {
    return this.attachedSessionReconciler.syncReplyState(agentSession);
  }

  reconcileAttachedAgentSession<T extends AgentSessionSummary | AgentSessionDetail>(agentSession: T): T {
    return this.attachedSessionReconciler.reconcile(agentSession);
  }

  markSessionRecoveryRequiredAfterShutdown(survivor: SessionRunnerShutdownSurvivor) {
    markStoreBackedSessionRecoveryRequiredAfterShutdown({
      appendSystemLog: (sessionId, text) => this.appendLog(sessionId, "system", text),
      emitServerEvent: (event) => this.emitServerEvent(event),
      getSession: (sessionId) => this.getSession(sessionId),
      markPromptOutcomeUnknown: (sessionId) =>
        this.promptTransport.markOutcomeUnknown(sessionId),
      stopGitPolling: (sessionId) => this.gitPolling.stop(sessionId),
      toSummary: (session) => this.toSummary(session),
      updateSession: (sessionId, patch) => this.updateSession(sessionId, patch)
    }, survivor);
  }

  async beginShutdown() {
    const inputDrain = this.sessionInput.beginShutdown();
    const attachedSessionReconciliationDrain = this.attachedSessionReconciler.close();
    const promptDrain = this.promptTransport.beginShutdown();

    await Promise.all([
      attachedSessionReconciliationDrain,
      inputDrain,
      promptDrain
    ]);
  }

  getAttachedAgentSessionStateVersion(
    agentSession: Pick<AgentSessionSummary, "agentId" | "sourceSessionId">
  ) {
    return this.attachedSessionReconciler.getStateVersion(agentSession);
  }

  private async launchSession(input: StoreBackedSessionLaunchInput) {
    return launchStoreBackedManagedSession(
      this.callbackContext(),
      this.promptDeliveries,
      input
    );
  }

  private async createReadOnlyCodexSession(
    codexSession: CodexSessionSummary | CodexSessionDetail,
    reason: string
  ) {
    return createStoreBackedReadOnlyCodexSession(
      this.callbackContext(),
      codexSession,
      reason
    );
  }

  private async createReadOnlyClaudeSession(
    agentSession: AgentSessionSummary,
    options: { observeOnly?: boolean; reason: string }
  ) {
    return createStoreBackedReadOnlyClaudeSession(
      this.callbackContext(),
      agentSession,
      options
    );
  }

  private finishSession(sessionId: string, status: SessionStatus, exitCode: number | null) {
    const context = this.callbackContext();

    finishStoreBackedSession(
      context, this.promptTransport, this.sourceTurnInterrupts,
      sessionId, status, exitCode
    );
  }

  private appendLog(
    sessionId: string,
    stream: SessionLogLine["stream"],
    text: string,
    timestamp = new Date().toISOString()
  ) {
    appendSessionLog(
      createSessionLogAppendCallbacks(this.callbackContext()),
      sessionId,
      stream,
      text,
      timestamp
    );
  }

  private callbackContext(): StoreBackedSessionCallbackContext {
    return createStoreBackedSessionCallbackContext({
      appendLog: (sessionId, stream, text, timestamp) =>
        this.appendLog(sessionId, stream, text, timestamp),
      createReadOnlyClaudeSession: (agentSession, options) =>
        this.createReadOnlyClaudeSession(agentSession, options),
      createReadOnlyCodexSession: (codexSession, reason) =>
        this.createReadOnlyCodexSession(codexSession, reason),
      createWorkspace: (workspacePath) => this.createWorkspace(workspacePath),
      detachAttachedSession: (sessionId, options) =>
        this.detachAttachedSession(sessionId, options),
      emitServerEvent: (event) => this.emitServerEvent(event),
      findReadOnlyAttachedSession: (sourceSessionId, adapterId) =>
        this.findReadOnlyAttachedSession(sourceSessionId, adapterId),
      findReusableAttachedSession: (sourceSessionId, adapterId) =>
        this.findReusableAttachedSession(sourceSessionId, adapterId),
      finishSession: (sessionId, status, exitCode) =>
        this.finishSession(sessionId, status, exitCode),
      getSession: (sessionId) => this.getSession(sessionId),
      gitPolling: this.gitPolling,
      launchSession: (input) => this.launchSession(input),
      listWorkspaces: () => this.repository.listWorkspaces(),
      persistState: () => this.persistState(),
      repository: this.repository,
      restartClaudePromptTransport: (session, input) =>
        this.promptTransport.restartClaudePromptTransport(session, input),
      restartCodexTransport: (session, options) =>
        this.promptTransport.restartCodexTransport(session, options),
      resumeCodexSession: (codexSession, prompt) =>
        this.resumeCodexSession(codexSession, prompt),
      resumeAgentSession: (agentSession, prompt) =>
        this.resumeAgentSession(agentSession, prompt),
      schedulePersistState: () => this.schedulePersistState(),
      sendSourceInput: (session, child, input) =>
        this.promptTransport.sendSourceInput(session, child, input),
      sendInput: (sessionId, input) => this.sendInput(sessionId, input),
      sessionRunner: this.sessionRunner,
      syncWorkspaceFromGit: (workspaceId, git) =>
        this.syncWorkspaceFromGit(workspaceId, git),
      supportsSourceInput: (adapterId) =>
        this.promptTransport.supportsSourceInput(adapterId),
      toSummary: (session) => this.toSummary(session),
      updateSession: (sessionId, patch) => this.updateSession(sessionId, patch)
    });
  }

  private getSession(sessionId: string): SessionDetail | null {
    const session = this.repository.getSession(sessionId);

    return session ? structuredClone(this.withInputCapability(session)) : null;
  }

  private updateSession(sessionId: string, patch: Partial<SessionDetail>) {
    this.repository.updateSession(sessionId, patch);
  }

  private syncWorkspaceFromGit(workspaceId: string, git: GitSnapshot) {
    this.repository.syncWorkspaceFromGit(workspaceId, git);
  }

  private emitServerEvent(event: ServerEvent) {
    this.eventBus.publishServerEvent(event);
  }

  private async persistState() {
    await this.persistence.persistNow();
  }

  private schedulePersistState() {
    this.persistence.schedulePersist();
  }

  private findReusableAttachedSession(sourceSessionId: string, adapterId?: string) {
    return this.repository.findReusableAttachedSession(sourceSessionId, adapterId);
  }

  private findReadOnlyAttachedSession(sourceSessionId: string, adapterId?: string) {
    return this.repository.findReadOnlyAttachedSession(sourceSessionId, adapterId);
  }

  private async detachAttachedSession(
    sessionId: string,
    options: {
      reason: string;
    }
  ) {
    await detachManagedSession(
      createSessionFinalizationCallbacks(this.callbackContext()),
      sessionId,
      options
    );
  }
}
