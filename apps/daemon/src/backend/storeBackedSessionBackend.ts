import { randomUUID } from "node:crypto";

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
import { SourceTurnInterruptLifecycle } from "#agents/sourceTurnInterruptLifecycle";
import type { SourceTurnInterruptTarget } from "#agents/sourceTurnInterruptLifecycle";
import type { DaemonEventBus, ManagedSessionGitRefreshOptions } from "#application/ports";
import { daemonConfig } from "#config/daemonConfig";
import { getProductionSqliteDatabaseContext } from "#persistence/connection/sqliteConnection";
import type { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";
import { SqlitePromptDeliveryJournalStore } from "#persistence/journals/promptDeliveryJournalStore";
import { SqliteSourceTurnInterruptStore } from "#persistence/journals/sourceTurnInterruptStore";
import { DeskCueSqliteStateStorage } from "#persistence/state/sqliteStateStorage";
import { SessionGitPolling } from "#sessions/git/sessionGitPolling";
import { emptyReplyState } from "#sessions/model/sessionDefaults";
import { SessionRunner } from "#sessions/process/sessionRunner";
import { SessionRepository } from "#sessions/state/sessionRepository";

import { StoreBackedSessionOperations } from "./control/storeBackedSessionOperations.ts";
import { StoreBackedPersistenceController } from "./persistence/storeBackedPersistenceController.ts";

function getPromptRecoveryLog({
  canReconcileSourceTranscript,
  definitelyNotSent
}: {
  canReconcileSourceTranscript: boolean;
  definitelyNotSent: boolean;
}) {
  if (definitelyNotSent) {
    return "DeskCue restarted before prompt dispatch began. The prompt was not sent and was not retried automatically.\n";
  }
  if (canReconcileSourceTranscript) {
    return "DeskCue restarted while prompt delivery was in progress. The agent may still be working; DeskCue will check the source transcript and will not send the prompt again automatically.\n";
  }
  return "DeskCue restarted while the managed prompt transport was active. That transport cannot continue after restart; the delivery outcome is unknown and the prompt was not sent again.\n";
}

export class StoreBackedSessionBackend {
  private readonly repository = new SessionRepository();
  private readonly gitPolling: SessionGitPolling;
  private readonly persistence: StoreBackedPersistenceController;
  private readonly promptDeliveries: SqlitePromptDeliveryJournalStore;
  private readonly sessionRunner: SessionRunner;
  private readonly sourceTurnInterrupts: SourceTurnInterruptLifecycle;
  private readonly operations: StoreBackedSessionOperations;

  constructor(
    eventBus: DaemonEventBus,
    sqliteContext: SqliteDatabaseContext = getProductionSqliteDatabaseContext(
      daemonConfig.databaseFilePath
    ),
    sessionRunner: SessionRunner = new SessionRunner()
  ) {
    this.sessionRunner = sessionRunner;
    this.persistence = new StoreBackedPersistenceController(
      this.repository,
      new DeskCueSqliteStateStorage(sqliteContext)
    );
    this.promptDeliveries = new SqlitePromptDeliveryJournalStore(sqliteContext);
    this.sourceTurnInterrupts = new SourceTurnInterruptLifecycle(
      new SqliteSourceTurnInterruptStore(sqliteContext)
    );
    this.gitPolling = new SessionGitPolling({
      getSession: (sessionId) => this.repository.getSession(sessionId),
      onGitSnapshot: (sessionId, git) => {
        this.repository.updateSession(sessionId, {
          git
        });
        const session = this.repository.getSession(sessionId);
        if (!session) {
          return;
        }

        this.operations.publishServerEvent({
          type: "session.git",
          payload: this.operations.toSummary(session)
        });
      }
    });
    this.operations = new StoreBackedSessionOperations({
      eventBus,
      gitPolling: this.gitPolling,
      persistence: this.persistence,
      repository: this.repository,
      sessionRunner: this.sessionRunner,
      sourceTurnInterrupts: this.sourceTurnInterrupts,
      promptDeliveries: this.promptDeliveries
    });
  }

  static async create(
    eventBus: DaemonEventBus,
    sqliteContext?: SqliteDatabaseContext,
    sessionRunner?: SessionRunner
  ) {
    const store = new StoreBackedSessionBackend(eventBus, sqliteContext, sessionRunner);
    await store.hydrate();
    return store;
  }

  listWorkspaces() {
    return this.repository.listWorkspaces();
  }

  listSessions() {
    return this.repository.listSessionDetails()
      .map((session) => this.operations.toSummary(session));
  }

  getSession(id: string) {
    const session = this.repository.getSession(id);
    return session ? structuredClone(this.operations.withInputCapability(session)) : null;
  }

  publishServerEvent(event: ServerEvent) {
    this.operations.publishServerEvent(event);
  }

  async close() {
    await this.operations.beginShutdown();
    await this.gitPolling.close();
    const shutdownResult = await this.sessionRunner.close({
      preserve: (sessionId) => {
        const session = this.repository.getSession(sessionId);
        return Boolean(
          session?.sourceSessionId &&
          (session.adapterId === "codex" || session.adapterId === "claude-code")
        );
      }
    });
    for (const survivor of shutdownResult.survivors) {
      this.operations.markSessionRecoveryRequiredAfterShutdown(survivor);
    }
    if (shutdownResult.survivors.length > 0) {
      await this.persistence.persistNow();
    }
    await this.persistence.close();
    this.promptDeliveries.close();
    this.sourceTurnInterrupts.close();
  }

  async createWorkspace(rawPath: string) {
    return this.operations.createWorkspace(rawPath);
  }

  async startSession(input: CreateSessionInput) {
    return this.operations.startSession(input);
  }

  async resumeCodexSession(
    codexSession: CodexSessionSummary | CodexSessionDetail,
    prompt?: string
  ) {
    return this.operations.resumeCodexSession(codexSession, prompt);
  }

  async resumeClaudeSession(agentSession: AgentSessionSummary, prompt?: string) {
    return this.operations.resumeClaudeSession(agentSession, prompt);
  }

  async resumeAgentSession(agentSession: AgentSessionSummary, prompt?: string) {
    return this.operations.resumeAgentSession(agentSession, prompt);
  }

  async refreshSessionGit(sessionId: string, options?: ManagedSessionGitRefreshOptions) {
    return this.operations.refreshSessionGit(sessionId, options);
  }

  setPreviewPort(sessionId: string, port: number | null, networkMode?: PreviewNetworkMode) {
    return this.operations.setPreviewPort(sessionId, port, networkMode);
  }

  capturePreviewArtifact(sessionId: string, payload: CapturePreviewArtifactPayload) {
    return this.operations.capturePreviewArtifact(sessionId, payload);
  }

  async sendInput(sessionId: string, input: string) {
    return this.operations.sendInput(sessionId, input);
  }

  async startQueuedPrompt(sessionId: string) {
    return this.operations.startQueuedPrompt(sessionId);
  }

  async markPromptRecoveryOutcomeUnknown(sessionId: string) {
    return this.operations.markPromptRecoveryOutcomeUnknown(sessionId);
  }

  interruptSession(sessionId: string, sourceTurn?: SourceTurnInterruptTarget | null) {
    return this.operations.interruptSession(sessionId, sourceTurn);
  }

  getExternalClaudeBackgroundStopCapability(
    sessionId: string
  ): Promise<ExternalClaudeBackgroundStopCapability> {
    return this.operations.getExternalClaudeBackgroundStopCapability(sessionId);
  }

  getExternalDesktopInterruptCapability(sessionId: string) {
    return this.operations.getExternalDesktopInterruptCapability(sessionId);
  }

  stopExternalClaudeBackground(sessionId: string) {
    return this.operations.stopExternalClaudeBackground(sessionId);
  }

  interruptExternalDesktopSession(
    sessionId: string,
    sourceTurn?: SourceTurnInterruptTarget | null
  ) {
    return this.operations.interruptExternalDesktopSession(sessionId, sourceTurn);
  }

  openExternalCodexDesktopChat(sessionId: string) {
    return this.operations.openExternalCodexDesktopChat(sessionId);
  }

  getExternalForceStopCapability(sessionId: string) {
    return this.operations.getExternalForceStopCapability(sessionId);
  }

  forceStopExternalProcess(
    sessionId: string,
    target: ExternalForceStopTarget,
    sourceTurn?: SourceTurnInterruptTarget | null
  ) {
    return this.operations.forceStopExternalProcess(sessionId, target, sourceTurn);
  }

  stopSession(sessionId: string) {
    return this.operations.stopSession(sessionId);
  }

  syncReplyStateFromAgentSession(agentSession: AgentSessionDetail) {
    return this.operations.syncReplyStateFromAgentSession(agentSession);
  }

  reconcileAttachedAgentSession<T extends AgentSessionSummary | AgentSessionDetail>(agentSession: T): T {
    return this.operations.reconcileAttachedAgentSession(agentSession);
  }

  getAttachedAgentSessionStateVersion(
    agentSession: Pick<AgentSessionSummary, "agentId" | "sourceSessionId">
  ) {
    return this.operations.getAttachedAgentSessionStateVersion(agentSession);
  }

  private async hydrate() {
    await this.persistence.hydrate();
    const recoveredPrompts = this.promptDeliveries.recoverActiveAfterRestart();
    const latestRecoveryBySession = new Map(
      recoveredPrompts.map((prompt) => [prompt.sessionId, prompt])
    );
    let recoveryStateChanged = false;
    for (const prompt of latestRecoveryBySession.values()) {
      const session = this.repository.getSession(prompt.sessionId);
      if (!session) {
        this.promptDeliveries.markInterrupted(prompt.sessionId);
        continue;
      }

      const definitelyNotSent = prompt.recoveryDisposition === "definitely_not_sent";
      const canReconcileSourceTranscript =
        Boolean(prompt.sourceSessionId) &&
        (prompt.adapterId === "codex" || prompt.adapterId === "claude-code");
      const recoveryPhase = definitelyNotSent
        ? "not_sent"
        : canReconcileSourceTranscript
          ? "checking"
          : "outcome_unknown";
      const alreadyMaterialized =
        session.promptRecovery?.promptText === prompt.promptText &&
        session.promptRecovery.requestedAt === prompt.requestedAt;
      this.repository.updateSession(session.id, {
        replyState: emptyReplyState(),
        promptRecovery: {
          phase: recoveryPhase,
          promptText: prompt.promptText,
          requestedAt: prompt.requestedAt,
          retryable: definitelyNotSent
        },
        logs: alreadyMaterialized
          ? session.logs
          : [
              ...session.logs,
              {
                id: randomUUID(),
                timestamp: new Date().toISOString(),
                stream: "system",
                text: getPromptRecoveryLog({
                  canReconcileSourceTranscript,
                  definitelyNotSent
                })
              }
            ]
      });
      recoveryStateChanged = true;
    }
    for (const session of this.repository.listSessionDetails()) {
      if (session.promptRecovery && !latestRecoveryBySession.has(session.id)) {
        this.repository.updateSession(session.id, {
          promptRecovery: null
        });
        recoveryStateChanged = true;
      }
    }
    if (recoveryStateChanged) {
      await this.persistence.persistFull();
    }
  }
}
