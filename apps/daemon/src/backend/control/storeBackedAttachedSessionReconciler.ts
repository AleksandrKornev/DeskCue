import { createHash } from "node:crypto";

import type { AgentSessionDetail, AgentSessionSummary, SessionDetail } from "@deskcue/protocol";
import type { SourceTurnInterruptLifecycle } from "#agents/sourceTurnInterruptLifecycle";
import { logger } from "#infrastructure/logging/logger";
import type { SessionRunner } from "#sessions/process/sessionRunner";
import {
  reconcileAttachedAgentSession,
  syncManagedSessionReplyState
} from "#sessions/replyState/sessionReplyStateSync";
import type { SessionRepository } from "#sessions/state/sessionRepository";

import { createSessionReplyStateSyncCallbacks } from "../callbacks/storeBackedSessionCallbacks.ts";
import type { StoreBackedSessionCallbackContext } from "../callbacks/storeBackedSessionCallbacks.ts";

type StoreBackedAttachedSessionReconcilerOptions = {
  getCallbackContext: () => StoreBackedSessionCallbackContext;
  markPromptObserved: (sessionId: string) => void;
  markPromptCompleted: (sessionId: string) => void;
  persistState: () => Promise<void>;
  repository: SessionRepository;
  sessionRunner: SessionRunner;
  sourceTurnInterrupts: SourceTurnInterruptLifecycle;
  startQueuedPrompt: (session: SessionDetail) => Promise<SessionDetail>;
};

export class StoreBackedAttachedSessionReconciler {
  private closed = false;
  private readonly inFlightPersistenceOperations = new Set<Promise<void>>();
  private readonly pendingPromptRecoveryResolutions = new Map<
    string,
    { completed: boolean; inFlight: boolean }
  >();

  constructor(
    private readonly options: StoreBackedAttachedSessionReconcilerOptions
  ) {}

  syncReplyState(agentSession: AgentSessionDetail) {
    if (this.closed) {
      return null;
    }
    const recoverySession = this.options.repository.listSessionDetails().find(
      (session) =>
        session.adapterId === agentSession.agentId &&
        session.sourceSessionId === agentSession.sourceSessionId &&
        Boolean(session.promptRecovery)
    );
    const callbacks = createSessionReplyStateSyncCallbacks(
      this.options.getCallbackContext(),
      { startQueuedPrompt: this.options.startQueuedPrompt }
    );
    let syncPersistence: Promise<void> | null = null;
    const result = syncManagedSessionReplyState(
      {
        ...callbacks,
        persistState: () => {
          syncPersistence = this.trackPersistence(this.options.persistState());
          return syncPersistence;
        }
      },
      agentSession
    );
    if (recoverySession && result && !result.promptRecovery) {
      this.scheduleRecoveredPromptResolution(
        result.id,
        result.replyState.phase === "idle",
        syncPersistence
      );
    } else if (result && this.pendingPromptRecoveryResolutions.has(result.id)) {
      this.scheduleRecoveredPromptResolution(
        result.id,
        result.replyState.phase === "idle",
        syncPersistence
      );
    } else if (result?.replyState.phase === "idle" && !result.promptRecovery) {
      this.options.markPromptCompleted(result.id);
    }
    return result;
  }

  private scheduleRecoveredPromptResolution(
    sessionId: string,
    completed: boolean,
    persistence: Promise<void> | null = null
  ) {
    if (this.closed) {
      return;
    }
    const existing = this.pendingPromptRecoveryResolutions.get(sessionId);
    const resolution = existing ?? { completed, inFlight: false };
    resolution.completed ||= completed;
    this.pendingPromptRecoveryResolutions.set(sessionId, resolution);
    if (resolution.inFlight) {
      return;
    }

    resolution.inFlight = true;
    void this.trackPersistence(
      this.resolveRecoveredPrompt(sessionId, resolution, persistence)
    );
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await Promise.allSettled([...this.inFlightPersistenceOperations]);
  }

  private trackPersistence(operation: Promise<void>) {
    this.inFlightPersistenceOperations.add(operation);
    void operation.then(
      () => this.inFlightPersistenceOperations.delete(operation),
      () => this.inFlightPersistenceOperations.delete(operation)
    );
    return operation;
  }

  private async resolveRecoveredPrompt(
    sessionId: string,
    resolution: { completed: boolean; inFlight: boolean },
    persistence: Promise<void> | null
  ) {
    try {
      await (persistence ?? this.options.persistState());
      const persistedSession = this.options.repository.getSession(sessionId);
      if (!persistedSession || persistedSession.promptRecovery) {
        this.pendingPromptRecoveryResolutions.delete(sessionId);
        return;
      }
      if (resolution.completed) {
        this.options.markPromptCompleted(sessionId);
      } else {
        this.options.markPromptObserved(sessionId);
      }
      this.pendingPromptRecoveryResolutions.delete(sessionId);
    } catch (error) {
      resolution.inFlight = false;
      logger.error("Failed to persist resolved prompt recovery", {
        message: error instanceof Error ? error.message : String(error),
        sessionId
      });
    }
  }

  reconcile<T extends AgentSessionSummary | AgentSessionDetail>(agentSession: T): T {
    // A daemon restart can happen after the owned process has exited but before
    // its exit callback had a chance to persist the interrupt confirmation.
    // Reconcile that durable stopped-session fact before projecting the source
    // chat, so a DeskCue-owned turn is never presented as an external one.
    for (const session of this.options.repository.listSessionDetails()) {
      if (
        session.adapterId === agentSession.agentId &&
        session.sourceSessionId === agentSession.sourceSessionId &&
        (session.status === "stopped" || session.status === "read_only") &&
        !this.options.sessionRunner.hasChild(session.id)
      ) {
        this.options.sourceTurnInterrupts.confirmManagedTransportExit(session);
      }
    }

    const decorated = this.options.sourceTurnInterrupts.decorate(agentSession);
    return reconcileAttachedAgentSession(
      this.options.repository.listSessionDetails(),
      (sessionId) => this.options.sessionRunner.hasChild(sessionId),
      decorated
    );
  }

  getStateVersion(
    agentSession: Pick<AgentSessionSummary, "agentId" | "sourceSessionId">
  ) {
    const sourceSessionId = agentSession.sourceSessionId;
    const attachedSessions = this.options.repository.listSessionDetails()
      .filter((session) =>
        session.adapterId === agentSession.agentId &&
        session.sourceSessionId === sourceSessionId
      )
      .map((session) => {
        const interruptLogs = session.logs.filter((log) =>
          log.text.includes("Prompt interrupt requested.")
        );
        const lastLog = session.logs.at(-1);

        return {
          hasChild: this.options.sessionRunner.hasChild(session.id),
          id: session.id,
          inputHistoryLength: session.inputHistory.length,
          interruptLogs: interruptLogs.map((log) => ({
            id: log.id,
            timestamp: log.timestamp
          })),
          lastActivityAt: session.lastActivityAt,
          lastInputLength: session.inputHistory.at(-1)?.length ?? 0,
          lastLogId: lastLog?.id ?? null,
          lastLogTimestamp: lastLog?.timestamp ?? null,
          logCount: session.logs.length,
          interruptLifecycle: this.options.sourceTurnInterrupts.getStateVersion(
            agentSession.agentId,
            sourceSessionId
          ),
          replyState: session.replyState,
          promptRecovery: session.promptRecovery ?? null,
          status: session.status
        };
      });

    if (attachedSessions.length === 0) {
      return "none";
    }

    return createHash("sha1")
      .update(JSON.stringify(attachedSessions))
      .digest("base64url");
  }
}
