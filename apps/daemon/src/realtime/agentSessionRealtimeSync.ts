import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

import type { AgentSessionDetail, AgentSessionSummary } from "@deskcue/protocol";
import { buildAgentSessionId } from "#agents/sourceAgentSessions";
import type { DaemonApplication } from "#application/daemonApplication";
import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

import { AgentSessionSourceTracker } from "./agentSessionSourceTracker.ts";
import { AgentSessionTurnEventProjector } from "./agentSessionTurnEventProjector.ts";
import { AgentSessionTurnStateRepository } from "./agentSessionTurnStateRepository.ts";

type AgentSessionRealtimeSyncOptions = {
  initialSourceDetailLimit?: number;
  publishSummaries?: boolean;
  syncManagedSessions?: boolean;
  trackExternalTurns?: boolean;
  sourceSessionLimit?: number;
};

type AgentSessionRealtimeSyncRuntimeOptions = {
  turnStateStoragePath?: string | null;
};

const TURN_TRACKING_TRANSCRIPT_TAIL = 24;
const SLOW_REALTIME_SYNC_LOG_THRESHOLD_MS = 100;
const DEFAULT_SOURCE_SESSION_SYNC_LIMIT = 50;
const DEFAULT_INITIAL_SOURCE_DETAIL_LIMIT = 2;
const TURN_STATE_STORAGE_FILE = "agent-session-turn-states.json";

function toAgentSessionSummary(detail: AgentSessionDetail): AgentSessionSummary {
  const { transcript: _transcript, ...summary } = detail;
  return summary;
}

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

export function createAgentSessionRealtimeSync(
  application: DaemonApplication,
  hasClients: () => boolean,
  runtimeOptions: AgentSessionRealtimeSyncRuntimeOptions = {}
) {
  const sourceTracker = new AgentSessionSourceTracker();
  const turnStateStoragePath =
    runtimeOptions.turnStateStoragePath === undefined
      ? join(dirname(daemonConfig.databaseFilePath), TURN_STATE_STORAGE_FILE)
      : runtimeOptions.turnStateStoragePath;
  const turnStates = new AgentSessionTurnStateRepository(turnStateStoragePath);
  const turnEvents = new AgentSessionTurnEventProjector(
    application,
    sourceTracker,
    turnStates
  );
  let isRunning = false;

  return async function syncAgentSessionsRealtime(
    options: AgentSessionRealtimeSyncOptions = {}
  ) {
    if (isRunning) {
      return;
    }

    isRunning = true;
    const startedAt = performance.now();
    let listedSessions = 0;
    let detailedExternalSessions = 0;
    let detailedManagedSessions = 0;
    let publishedSummaries = 0;
    let publishedTurnEvents = 0;
    let publishedTranscriptEvents = 0;
    let sourceSessionLimit =
      options.sourceSessionLimit ?? DEFAULT_SOURCE_SESSION_SYNC_LIMIT;
    let initialSourceDetailLimit =
      options.initialSourceDetailLimit ??
      Math.min(sourceSessionLimit, DEFAULT_INITIAL_SOURCE_DETAIL_LIMIT);

    try {
      await turnStates.loadIfNeeded();

      const shouldPublishSummaries = options.publishSummaries ?? hasClients();
      const shouldTrackExternalTurns = options.trackExternalTurns ?? true;
      const shouldSyncManagedSessions = options.syncManagedSessions ?? true;
      const shouldListAgentSessions = shouldPublishSummaries || shouldTrackExternalTurns;
      sourceSessionLimit =
        options.sourceSessionLimit ?? DEFAULT_SOURCE_SESSION_SYNC_LIMIT;
      initialSourceDetailLimit =
        options.initialSourceDetailLimit ??
        Math.min(sourceSessionLimit, DEFAULT_INITIAL_SOURCE_DETAIL_LIMIT);
      const listedAgentSessionsById = new Map<string, AgentSessionSummary>();
      const changedAgentSessionIds = new Set<string>();
      const unchangedAgentSessionIds = new Set<string>();
      const agentSessionDetailsById = new Map<string, AgentSessionDetail>();
      const nextIds = new Set<string>();

      if (shouldListAgentSessions) {
        const agentSessions = await application.sourceAgentSessions.listRecentSessions(
          sourceSessionLimit,
          false
        );
        listedSessions = agentSessions.length;

        for (const agentSession of agentSessions) {
          let reconciledSession =
            application.sourceAgentSessions.reconcileAttachedSession(agentSession);
          listedAgentSessionsById.set(reconciledSession.id, reconciledSession);
          let summaryCandidate =
            sourceTracker.getSummary(reconciledSession.id) ?? reconciledSession;
          nextIds.add(reconciledSession.id);

          const fileChangeState = shouldTrackExternalTurns
            ? await sourceTracker.readFileChangeState(
                reconciledSession,
                turnStates.get(reconciledSession.id)?.state
              )
            : "unknown";
          const shouldPrimeUnseenSession =
            (fileChangeState === "new" || fileChangeState === "unchanged") &&
            !sourceTracker.hasSummary(reconciledSession.id) &&
            initialSourceDetailLimit > 0;
          if (fileChangeState === "changed" || shouldPrimeUnseenSession) {
            if (shouldPrimeUnseenSession) {
              initialSourceDetailLimit -= 1;
            }
            changedAgentSessionIds.add(reconciledSession.id);
            const detail = await application.sourceAgentSessions.getSessionDetail(
              reconciledSession.id,
              false,
              TURN_TRACKING_TRANSCRIPT_TAIL,
              undefined,
              {
                lightweight: "exact-ids"
              }
            );
            if (detail) {
              agentSessionDetailsById.set(reconciledSession.id, detail);
              detailedExternalSessions += 1;
              const reconciledDetail =
                application.sourceAgentSessions.reconcileAttachedSession(detail);
              application.sourceAgentSessions.syncReplyStateFromAgentSession(
                reconciledDetail
              );
              summaryCandidate = toAgentSessionSummary(reconciledDetail);
              reconciledSession = summaryCandidate;
              sourceTracker.setSummary(summaryCandidate);
              if (
                turnEvents.shouldTrack(
                  reconciledDetail,
                  turnStates.get(reconciledDetail.id)?.state
                )
              ) {
                const result = await turnEvents.update(reconciledDetail, "external");
                publishedTurnEvents += result.turnEvents;
                publishedTranscriptEvents += result.transcriptEvents;
              }
            }
          } else if (fileChangeState === "unchanged") {
            unchangedAgentSessionIds.add(reconciledSession.id);
          }

          if (
            shouldPublishSummaries &&
            sourceTracker.shouldPublishSummary(summaryCandidate)
          ) {
            application.events.publishServerEvent({
              type: "agent.session.updated",
              payload: summaryCandidate
            });
            publishedSummaries += 1;
          }
        }

        sourceTracker.pruneSummaries(nextIds);
        for (const sessionId of Array.from(turnStates.keys())) {
          if (!nextIds.has(sessionId)) {
            turnStates.delete(sessionId);
            sourceTracker.deleteSession(sessionId);
          }
        }
      }

      if (!shouldSyncManagedSessions) {
        return;
      }

      const runningAttachedSessions = application.managedSessions
        .listSessions()
        .filter((session) => session.status === "running" && session.sourceSessionId);

      await Promise.allSettled(
        runningAttachedSessions.map(async (session) => {
          const agentSessionId = buildAgentSessionId(
            session.adapterId,
            session.sourceSessionId!
          );
          const listedAgentSession = listedAgentSessionsById.get(agentSessionId);
          if (
            listedAgentSession &&
            unchangedAgentSessionIds.has(agentSessionId) &&
            !changedAgentSessionIds.has(agentSessionId)
          ) {
            return;
          }

          const agentSession =
            agentSessionDetailsById.get(agentSessionId) ??
            (await application.sourceAgentSessions.getSessionDetail(
              agentSessionId,
              false,
              TURN_TRACKING_TRANSCRIPT_TAIL,
              undefined,
              {
                lightweight: true
              }
            ));
          if (!agentSession) {
            return;
          }

          if (!agentSessionDetailsById.has(agentSessionId)) {
            detailedManagedSessions += 1;
          }
          application.sourceAgentSessions.syncReplyStateFromAgentSession(
            application.sourceAgentSessions.reconcileAttachedSession(agentSession)
          );
          const result = await turnEvents.update(
            application.sourceAgentSessions.reconcileAttachedSession(agentSession),
            "managed"
          );
          publishedTurnEvents += result.turnEvents;
          publishedTranscriptEvents += result.transcriptEvents;
        })
      );
    } catch (error) {
      logger.warn("Agent session realtime sync failed", {
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await turnStates.persistIfDirty();

      const totalDurationMs = elapsedMs(startedAt);
      if (totalDurationMs >= SLOW_REALTIME_SYNC_LOG_THRESHOLD_MS) {
        logger.info("Agent session realtime sync completed", {
          detailedExternalSessions,
          detailedManagedSessions,
          listedSessions,
          publishSummaries: options.publishSummaries ?? hasClients(),
          publishedSummaries,
          publishedTranscriptEvents,
          publishedTurnEvents,
          sourceSessionLimit,
          syncManagedSessions: options.syncManagedSessions ?? true,
          totalDurationMs,
          trackExternalTurns: options.trackExternalTurns ?? true
        });
      }
      isRunning = false;
    }
  };
}
