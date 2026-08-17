import type {
  AgentSessionDetail,
  AgentKind,
  AgentSessionSourceVersion,
  AgentSessionsResponse,
  AgentSessionSummary,
  AgentTranscriptEntry,
  CodexSessionDetail,
  CodexSessionSummary,
  SessionDetail
} from "@deskcue/protocol";
import { copySourceAgentDetailMetadata } from "#agents/sourceAgentDetailMetadata";

import { AppError } from "./errors.ts";
import type {
  AgentSessionReviewStore,
  DaemonEventBus,
  SourceAgentLightweightMode,
  SourceAgentSessionBackend,
  SourceAgentSessionDiscovery
} from "./ports.ts";
import type { WorkspaceService } from "./workspaceService.ts";

const noopReviews: AgentSessionReviewStore = {
  decorateSession: (session) => session,
  decorateSessions: (sessions) => sessions,
  markReviewed: (_agentSessionId, reviewedAt = new Date().toISOString()) => reviewedAt
};

const noopEvents: DaemonEventBus = {
  on: () => undefined,
  publishServerEvent: () => undefined
};

const SOURCE_AGENT_IN_FLIGHT_LIMIT = 16;
const SOURCE_AGENT_QUEUE_CAPACITY = 128;

type SourceAgentInFlightOperation = "detail" | "entries" | "version";

type QueuedSourceAgentRead = {
  key: string;
  reject: (reason?: unknown) => void;
  start: () => void;
};

type SourceAgentSessionServiceOptions = {
  concurrency?: number;
  queueCapacity?: number;
};

function readPositiveInteger(value: number | undefined, fallback: number, label: string) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return resolved;
}

function buildSourceAgentInFlightKey(
  operation: SourceAgentInFlightOperation,
  parts: Array<boolean | number | string>
) {
  return [operation, ...parts].join("\u0000");
}

function decorateSessionPreservingMetadata<T extends AgentSessionSummary | AgentSessionDetail>(
  source: T,
  decorated: T
): T {
  if (source === decorated) {
    return decorated;
  }

  return copySourceAgentDetailMetadata(source, decorated);
}

function toAgentSessionSummary(session: AgentSessionDetail): AgentSessionSummary {
  const {
    transcript: _transcript,
    ...summary
  } = session;
  return summary;
}

export class SourceAgentSessionService {
  private activeReadCount = 0;
  private readonly activeReads = new Set<Promise<unknown>>();
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private readonly concurrency: number;
  private readonly inFlightReads = new Map<string, Promise<unknown>>();
  private readonly queueCapacity: number;
  private readonly queuedReads: QueuedSourceAgentRead[] = [];

  constructor(
    private readonly backend: SourceAgentSessionBackend,
    private readonly discovery: SourceAgentSessionDiscovery,
    private readonly workspaces: WorkspaceService,
    private readonly reviews: AgentSessionReviewStore = noopReviews,
    private readonly events: DaemonEventBus = noopEvents,
    options: SourceAgentSessionServiceOptions = {}
  ) {
    this.concurrency = readPositiveInteger(
      options.concurrency,
      SOURCE_AGENT_IN_FLIGHT_LIMIT,
      "Source-agent read concurrency"
    );
    this.queueCapacity = readPositiveInteger(
      options.queueCapacity,
      SOURCE_AGENT_QUEUE_CAPACITY,
      "Source-agent read queue capacity"
    );
  }

  close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closed = true;
    const shutdownError = new AppError("conflict", "Source-agent session service is shutting down.");
    for (const queued of this.queuedReads.splice(0)) {
      if (this.inFlightReads.get(queued.key)) {
        this.inFlightReads.delete(queued.key);
      }
      queued.reject(shutdownError);
    }

    this.closePromise = Promise.allSettled([...this.activeReads]).then(() => undefined);
    return this.closePromise;
  }

  listWorkspaceSummaries() {
    return this.workspaces.listWorkspaces();
  }

  readIndexStats() {
    return this.discovery.readIndexStats();
  }

  async listRecentSessions(
    limit = 50,
    includeLiveMetadata = false,
    options: {
      force?: boolean;
    } = {}
  ): Promise<AgentSessionSummary[]> {
    const sessions = await this.discovery.listRecentSessions(
      limit,
      this.workspaces.listWorkspaces(),
      {
        force: options.force,
        includeLiveMetadata
      }
    );
    return this.reviews.decorateSessions(sessions);
  }

  async listRecentSessionPage(
    limit = 50,
    includeLiveMetadata = false,
    options: {
      force?: boolean;
      offset?: number;
      query?: string | null;
      sourceId?: AgentKind | null;
    } = {}
  ): Promise<AgentSessionsResponse> {
    const page = await this.discovery.listRecentSessionPage(
      limit,
      this.workspaces.listWorkspaces(),
      {
        force: options.force,
        includeLiveMetadata,
        offset: options.offset,
        query: options.query,
        sourceId: options.sourceId
      }
    );
    return {
      ...page,
      sessions: this.reviews.decorateSessions(page.sessions)
    };
  }

  async getSessionDetail(
    agentSessionId: string,
    includeLiveMetadata = false,
    transcriptTail?: number,
    chatMessageTail?: number,
    options: {
      lightweight?: SourceAgentLightweightMode;
    } = {}
  ): Promise<AgentSessionDetail | null> {
    const session = await this.dedupeRead(
      buildSourceAgentInFlightKey("detail", [
        agentSessionId,
        includeLiveMetadata,
        transcriptTail ?? "",
        chatMessageTail ?? "",
        options.lightweight === undefined || options.lightweight === false
          ? ""
          : `lightweight:${options.lightweight}`
      ]),
      () =>
        this.discovery.getSessionDetail(
          agentSessionId,
          includeLiveMetadata,
          transcriptTail,
          chatMessageTail,
          options
        )
    );
    return session
      ? decorateSessionPreservingMetadata(session, this.reviews.decorateSession(session))
      : null;
  }

  async getSessionVersion(
    agentSessionId: string,
    includeLiveMetadata = false
  ): Promise<AgentSessionSourceVersion | null> {
    const version = await this.dedupeRead(
      buildSourceAgentInFlightKey("version", [agentSessionId, includeLiveMetadata]),
      () => this.discovery.getSessionVersion(agentSessionId, includeLiveMetadata)
    );
    if (!version) {
      return null;
    }

    const summary = this.backend.reconcileAttachedAgentSession(
      this.reviews.decorateSession(version.summary)
    );
    return {
      ...version,
      localStateVersion: this.backend.getAttachedAgentSessionStateVersion(summary),
      summary
    };
  }

  getTranscriptEntries(
    agentSessionId: string,
    entryIds: string[]
  ): Promise<AgentTranscriptEntry[]> {
    const normalizedEntryIds = [...new Set(entryIds)];
    const cacheEntryIds = [...normalizedEntryIds].sort();
    return this.dedupeRead(
      buildSourceAgentInFlightKey("entries", [agentSessionId, cacheEntryIds.join("\u0001")]),
      () => this.discovery.getTranscriptEntries(agentSessionId, normalizedEntryIds)
    );
  }

  getTranscriptWindow(
    agentSessionId: string,
    options: {
      baseSourceEntryId: string;
      maxLineCount?: number;
      overlapLineCount?: number;
    }
  ): Promise<AgentTranscriptEntry[] | null> {
    const readTranscriptWindow = this.discovery.getTranscriptWindow;
    if (!readTranscriptWindow) {
      return Promise.resolve(null);
    }

    return this.dedupeRead(
      buildSourceAgentInFlightKey("entries", [
        agentSessionId,
        "window",
        options.baseSourceEntryId,
        options.overlapLineCount ?? "",
        options.maxLineCount ?? ""
      ]),
      () => readTranscriptWindow.call(this.discovery, agentSessionId, options)
    );
  }

  getTranscriptTailWindow(
    agentSessionId: string,
    options: {
      chatMessageTail?: number;
    } = {}
  ): Promise<AgentTranscriptEntry[] | null> {
    const readTranscriptTailWindow = this.discovery.getTranscriptTailWindow;
    if (!readTranscriptTailWindow) {
      return Promise.resolve(null);
    }

    return this.dedupeRead(
      buildSourceAgentInFlightKey("entries", [
        agentSessionId,
        "tail-window",
        options.chatMessageTail ?? ""
      ]),
      () => readTranscriptTailWindow.call(this.discovery, agentSessionId, options)
    );
  }

  getTranscriptPreviousWindow(
    agentSessionId: string,
    options: {
      beforeEntryId: string;
    }
  ): Promise<{ entries: AgentTranscriptEntry[]; hasMore: boolean } | null> {
    const readTranscriptPreviousWindow = this.discovery.getTranscriptPreviousWindow;
    if (!readTranscriptPreviousWindow) {
      return Promise.resolve(null);
    }

    return this.dedupeRead(
      buildSourceAgentInFlightKey("entries", [
        agentSessionId,
        "previous-window",
        options.beforeEntryId
      ]),
      () => readTranscriptPreviousWindow.call(this.discovery, agentSessionId, options)
    );
  }

  async markSessionReviewed(agentSessionId: string) {
    const reviewedAt = this.reviews.markReviewed(agentSessionId);
    this.events.publishServerEvent({
      type: "agent.session.reviewed",
      payload: {
        agentSessionId,
        reviewedAt
      }
    });

    const session = await this.getSessionDetail(agentSessionId);
    if (session) {
      this.events.publishServerEvent({
        type: "agent.session.updated",
        payload: toAgentSessionSummary(session)
      });
    }

    return {
      agentSessionId,
      reviewedAt
    };
  }

  listCodexSessions() {
    return this.discovery.listCodexSessions();
  }

  getCodexSessionDetail(sessionId: string): Promise<CodexSessionDetail | null> {
    return this.discovery.getCodexSessionDetail(sessionId);
  }

  reconcileAttachedSession<T extends AgentSessionSummary | AgentSessionDetail>(session: T): T {
    return this.backend.reconcileAttachedAgentSession(session);
  }

  syncReplyStateFromAgentSession(agentSession: AgentSessionDetail): SessionDetail | null {
    return this.backend.syncReplyStateFromAgentSession(agentSession);
  }

  resumeAgentSession(agentSession: AgentSessionSummary, prompt?: string): Promise<SessionDetail> {
    return this.backend.resumeAgentSession(agentSession, prompt);
  }

  resumeCodexSession(
    codexSession: CodexSessionSummary | CodexSessionDetail,
    prompt?: string
  ): Promise<SessionDetail> {
    return this.backend.resumeCodexSession(codexSession, prompt);
  }

  private dedupeRead<T>(key: string, read: () => Promise<T>): Promise<T> {
    const existing = this.inFlightReads.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }
    if (this.closed) {
      return Promise.reject(
        new AppError("conflict", "Source-agent session service is shutting down.")
      );
    }
    if (this.queuedReads.length >= this.queueCapacity) {
      return Promise.reject(
        new AppError(
          "conflict",
          "Source-agent read queue is full. Retry after active transcript reads finish."
        )
      );
    }

    let rejectQueued!: (reason?: unknown) => void;
    let start!: () => void;
    const promise = new Promise<T>((resolve, reject) => {
      rejectQueued = reject;
      start = () => {
        this.activeReadCount += 1;
        this.activeReads.add(promise);
        const complete = () => {
          this.activeReadCount -= 1;
          this.activeReads.delete(promise);
          if (this.inFlightReads.get(key) === promise) {
            this.inFlightReads.delete(key);
          }
          this.startQueuedReads();
        };
        try {
          read().then(resolve, reject).then(complete, complete);
        } catch (error) {
          reject(error);
          complete();
        }
      };
    });
    this.inFlightReads.set(key, promise);
    this.queuedReads.push({
      key,
      reject: (reason) => {
        if (this.inFlightReads.get(key) === promise) {
          this.inFlightReads.delete(key);
        }
        rejectQueued(reason);
      },
      start
    });
    this.startQueuedReads();

    return promise;
  }

  private startQueuedReads() {
    while (
      !this.closed &&
      this.activeReadCount < this.concurrency &&
      this.queuedReads.length > 0
    ) {
      this.queuedReads.shift()?.start();
    }
  }
}
