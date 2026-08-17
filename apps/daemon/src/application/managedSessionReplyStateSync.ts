import type { AgentSessionDetail, SessionDetail } from "@deskcue/protocol";

import type { ManagedSessionBackend, SourceAgentSessionDiscovery } from "./ports.ts";

const MANAGED_REPLY_SYNC_TRANSCRIPT_TAIL = 160;
const MANAGED_REPLY_SYNC_CHAT_MESSAGE_TAIL = 8;
const MANAGED_REPLY_SYNC_OVERVIEW_THROTTLE_MS = 1_500;

function canStartQueuedCodexPrompt(sourceSession: AgentSessionDetail | null) {
  return Boolean(
    sourceSession &&
    sourceSession.attachMode === "resume" &&
    sourceSession.workState !== "running" &&
    sourceSession.turnState?.phase !== "active"
  );
}

export class ManagedSessionReplyStateSynchronizer {
  private readonly sessionSyncs = new Map<string, Promise<SessionDetail | null>>();
  private runningOverviewSync: Promise<void> | null = null;
  private overviewSyncedAt = 0;

  constructor(
    private readonly backend: ManagedSessionBackend,
    private readonly discovery: SourceAgentSessionDiscovery
  ) {}

  async startQueuedCodexPromptIfReady(
    sessionId: string,
    session: SessionDetail
  ): Promise<SessionDetail> {
    if (
      session.adapterId !== "codex" ||
      !session.sourceSessionId ||
      session.replyState.phase !== "queued"
    ) {
      return session;
    }

    // A read-only shell used to queue every Codex prompt and wait for the next
    // background source scan before it started. Read the source now: if that
    // chat is already resumable and idle, start the just-queued transport in
    // this request so the caller receives `sending`, not a misleading queue.
    const sourceSession = await this.discovery.getSessionDetailForManagedSession(
      session,
      MANAGED_REPLY_SYNC_TRANSCRIPT_TAIL,
      MANAGED_REPLY_SYNC_CHAT_MESSAGE_TAIL
    );
    if (!canStartQueuedCodexPrompt(sourceSession)) {
      return session;
    }

    return this.backend.startQueuedPrompt(sessionId);
  }

  async syncOverview(): Promise<void> {
    if (this.runningOverviewSync) {
      await this.runningOverviewSync;
      return;
    }
    if (Date.now() - this.overviewSyncedAt < MANAGED_REPLY_SYNC_OVERVIEW_THROTTLE_MS) {
      return;
    }

    const runningAttachedSessions = this.backend
      .listSessions()
      .filter((session) =>
        Boolean(session.sourceSessionId) &&
        (session.status === "running" ||
          (session.status === "read_only" && session.replyState.phase !== "idle") ||
          session.promptRecovery?.phase === "checking" ||
          session.promptRecovery?.phase === "outcome_unknown")
      );

    this.runningOverviewSync = Promise.allSettled(
      runningAttachedSessions.map((session) => this.syncSession(session.id))
    ).then(() => undefined);

    try {
      await this.runningOverviewSync;
      this.overviewSyncedAt = Date.now();
    } finally {
      this.runningOverviewSync = null;
    }
  }

  syncSession(sessionId: string): Promise<SessionDetail | null> {
    const runningSync = this.sessionSyncs.get(sessionId);
    if (runningSync) {
      return runningSync;
    }

    const operation = this.syncSessionNow(sessionId);
    const trackedOperation = operation.finally(() => {
      if (this.sessionSyncs.get(sessionId) === trackedOperation) {
        this.sessionSyncs.delete(sessionId);
      }
    });
    this.sessionSyncs.set(sessionId, trackedOperation);
    return trackedOperation;
  }

  private async syncSessionNow(sessionId: string): Promise<SessionDetail | null> {
    const session = this.backend.getSession(sessionId);
    if (
      !session ||
      !session.sourceSessionId ||
      (session.status !== "running" &&
        session.status !== "read_only" &&
        session.promptRecovery?.phase !== "checking" &&
        session.promptRecovery?.phase !== "outcome_unknown")
    ) {
      return session;
    }

    const agentSession = await this.discovery.getSessionDetailForManagedSession(
      session,
      MANAGED_REPLY_SYNC_TRANSCRIPT_TAIL,
      MANAGED_REPLY_SYNC_CHAT_MESSAGE_TAIL
    );
    if (!agentSession) {
      return this.backend.markPromptRecoveryOutcomeUnknown?.(sessionId) ?? session;
    }

    return (
      this.backend.syncReplyStateFromAgentSession(agentSession) ??
      this.backend.getSession(sessionId)
    );
  }
}
