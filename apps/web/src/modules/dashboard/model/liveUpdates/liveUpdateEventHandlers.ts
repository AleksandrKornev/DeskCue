import { startTransition } from "react";
import type { MutableRefObject } from "react";

import type {
  AgentSessionDetail,
  AgentSessionTranscriptUpdatedPayload,
  ServerEvent,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import {
  AGENT_SESSIONS_INVALIDATED_EVENT,
  AGENT_SESSION_SUMMARY_UPDATED_EVENT
} from "@models/agentSessions/contracts";
import type { AgentSessionSummaryUpdatedEventDetail } from "@models/agentSessions/contracts";
import { LOCAL_LLM_CHAT_UPDATED_EVENT } from "@models/live/localLlmChatEvents";
import type { LocalLlmChatUpdatedEventDetail } from "@models/live/localLlmChatEvents";
import type { SessionTab } from "@models/sessionTabs";
import type { LoadOptions } from "@modules/dashboard/model/data/dashboardLoad";
import { buildManagedSessionLoadOptionsForTab } from "@modules/dashboard/model/selection/managedSessionLoadOptions";
import type { DashboardStore } from "@modules/dashboard/model/store";

import { usesTakenOverAgentTranscript } from "./helpers";
import type { SelectedSessionLogQueue } from "./liveUpdateSelectedSessionLogQueue";

interface HandleLiveUpdateEventArgs {
  activeTabRef: MutableRefObject<SessionTab>;
  activeTakenOverAgentSessionIdRef: MutableRefObject<string>;
  event: ServerEvent;
  loadSessionRef: MutableRefObject<
    (sessionId: string, options?: LoadOptions) => Promise<SessionDetail | null>
  >;
  refreshTakenOverTranscriptNow: (
    updatedAt?: string | null,
    options?: {
      allowDuringPromptPolling?: boolean;
      force?: boolean;
      fullTranscript?: boolean;
    }
  ) => void;
  scheduleTakenOverTranscriptRefresh: (
    updatedAt?: string | null,
    options?: { allowDuringPromptPolling?: boolean; force?: boolean }
  ) => void;
  scheduleSelectedAgentSessionRefresh: (updatedAt?: string | null) => void;
  selectedAgentSessionIdRef: MutableRefObject<string>;
  selectedSessionIdRef: MutableRefObject<string>;
  selectedSessionLogQueue: SelectedSessionLogQueue;
  selectedSessionRef: MutableRefObject<SessionDetail | null>;
  store: DashboardStore;
}

function invalidateAgentSessionSummaries() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AGENT_SESSIONS_INVALIDATED_EVENT));
}

function isTerminalManagedSessionUpdate(session: SessionSummary) {
  return session.sourceSessionId !== null && session.status !== "running";
}

function isManagedSessionUpdateForActiveSource(
  session: SessionSummary,
  activeAgentSessionId: string
) {
  return session.adapterId !== null &&
    session.sourceSessionId !== null &&
    `${session.adapterId}:${session.sourceSessionId}` === activeAgentSessionId;
}

function isSourceUpdateForManagedSession(
  session: SessionDetail | null,
  agentSessionId: string
) {
  return Boolean(session?.adapterId) &&
    Boolean(session?.sourceSessionId) &&
    `${session?.adapterId}:${session?.sourceSessionId}` === agentSessionId;
}

function hasManagedSessionLifecycleDifference(
  current: SessionDetail,
  next: SessionSummary
) {
  return current.status !== next.status ||
    current.finishedAt !== next.finishedAt ||
    current.exitCode !== next.exitCode ||
    current.canSendInput !== next.canSendInput ||
    current.inputBlockedReason !== next.inputBlockedReason ||
    current.replyState.phase !== next.replyState.phase ||
    current.replyState.promptText !== next.replyState.promptText ||
    current.replyState.requestedAt !== next.replyState.requestedAt ||
    current.promptRecovery?.phase !== next.promptRecovery?.phase ||
    current.promptRecovery?.promptText !== next.promptRecovery?.promptText ||
    current.promptRecovery?.requestedAt !== next.promptRecovery?.requestedAt ||
    current.promptRecovery?.retryable !== next.promptRecovery?.retryable ||
    current.actionRequest?.kind !== next.actionRequest?.kind ||
    current.actionRequest?.command !== next.actionRequest?.command ||
    current.actionRequest?.reason !== next.actionRequest?.reason ||
    current.actionRequest?.requestedAt !== next.actionRequest?.requestedAt;
}

function isTerminalTranscriptUpdate(update: AgentSessionTranscriptUpdatedPayload) {
  return update.turnState?.phase !== undefined && update.turnState.phase !== "active";
}

function isAgentSessionDetailNewerThanRealtimeUpdate(
  current: AgentSessionDetail,
  update: AgentSessionTranscriptUpdatedPayload
) {
  const currentUpdatedAt = Date.parse(current.updatedAt);
  const updateUpdatedAt = Date.parse(update.updatedAt);

  if (!Number.isNaN(currentUpdatedAt) && !Number.isNaN(updateUpdatedAt)) return currentUpdatedAt > updateUpdatedAt;

  return current.updatedAt > update.updatedAt;
}

function isTerminalUpdateForCurrentTurn(
  current: AgentSessionDetail,
  update: AgentSessionTranscriptUpdatedPayload
) {
  const currentTurnState = current.turnState;
  const nextTurnState = update.turnState;

  if (
    !nextTurnState ||
    nextTurnState.phase === "active" ||
    !currentTurnState ||
    currentTurnState.phase !== "active"
  ) {
    return false;
  }

  if (
    currentTurnState.fingerprint &&
    currentTurnState.fingerprint === nextTurnState.fingerprint
  ) {
    return true;
  }

  if (nextTurnState.turnStartFingerprint) return nextTurnState.turnStartFingerprint === currentTurnState.fingerprint;
  if (nextTurnState.evidence !== "terminal_lifecycle") return false;

  const currentStartedAt = Date.parse(
    currentTurnState.startedAt ?? currentTurnState.activityAt ?? ""
  );
  const nextCompletedAt = Date.parse(nextTurnState.completedAt ?? "");

  return Number.isFinite(currentStartedAt) &&
    Number.isFinite(nextCompletedAt) &&
    nextCompletedAt > currentStartedAt;
}

function mergeAgentSessionRealtimeTranscriptState(
  current: AgentSessionDetail | null,
  update: AgentSessionTranscriptUpdatedPayload
) {
  if (
    !current ||
    current.id !== update.agentSessionId ||
    (
      isAgentSessionDetailNewerThanRealtimeUpdate(current, update) &&
      !isTerminalUpdateForCurrentTurn(current, update)
    )
  ) {
    return current;
  }

  return {
    ...current,
    updatedAt: current.updatedAt > update.updatedAt ? current.updatedAt : update.updatedAt,
    workState: update.workState,
    ...(update.turnState ? { turnState: update.turnState } : {})
  };
}

function publishAgentSessionSummary(
  session: AgentSessionSummaryUpdatedEventDetail["session"]
) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<AgentSessionSummaryUpdatedEventDetail>(
      AGENT_SESSION_SUMMARY_UPDATED_EVENT,
      { detail: { session } }
    ));
  }
}

export function handleLiveUpdateEvent({
  activeTabRef,
  activeTakenOverAgentSessionIdRef,
  event,
  loadSessionRef,
  refreshTakenOverTranscriptNow,
  scheduleTakenOverTranscriptRefresh,
  scheduleSelectedAgentSessionRefresh,
  selectedAgentSessionIdRef,
  selectedSessionIdRef,
  selectedSessionLogQueue,
  selectedSessionRef,
  store
}: HandleLiveUpdateEventArgs) {
  if (event.type === "protocol.hello") return;

  const selectedSessionId = selectedSessionIdRef.current;

  if (event.type === "local.llm.chat.updated") {
    window.dispatchEvent(new CustomEvent<LocalLlmChatUpdatedEventDetail>(
      LOCAL_LLM_CHAT_UPDATED_EVENT,
      { detail: event.payload }
    ));
    return;
  }

  if (
    event.type === "local.llm.chat.finished" ||
    event.type === "local.llm.chat.approval.required"
  ) {
    return;
  }

  if (event.type === "session.log") {
    if (event.payload.sessionId === selectedSessionId) {
      selectedSessionLogQueue.push(event.payload.sessionId, event.payload.log);
    } else {
      startTransition(() => {
        store.touchOverviewSession(event.payload.sessionId, event.payload.log.timestamp);
      });
    }

    return;
  }

  if (event.type === "workspace.created") {
    startTransition(() => {
      store.addWorkspaceSummary(event.payload);
    });
    return;
  }

  if (event.type === "agent.session.updated") {
    startTransition(() => {
      store.mergeAgentSessionSummary(event.payload);
      if (event.payload.workState === "running") store.clearAgentSessionReadyForReview(event.payload.id);
    });

    const shouldRefreshSelectedAgentSession =
      event.payload.id === selectedAgentSessionIdRef.current &&
      event.payload.id !== activeTakenOverAgentSessionIdRef.current;

    if (shouldRefreshSelectedAgentSession) scheduleSelectedAgentSessionRefresh(event.payload.updatedAt);

    publishAgentSessionSummary(event.payload);

    return;
  }

  if (event.type === "agent.session.transcript.updated") {
    startTransition(() => {
      store.updateSelectedAgentSession((current) =>
        mergeAgentSessionRealtimeTranscriptState(current, event.payload)
      );

      store.updateActiveTakenOverAgentSession((current) =>
        mergeAgentSessionRealtimeTranscriptState(current, event.payload)
      );

      if (event.payload.workState === "running") store.clearAgentSessionReadyForReview(event.payload.agentSessionId);
    });

    const shouldRefreshTakenOverAgentSession =
      event.payload.agentSessionId === activeTakenOverAgentSessionIdRef.current &&
      usesTakenOverAgentTranscript(activeTabRef.current);

    if (shouldRefreshTakenOverAgentSession) {
      const isTerminalUpdate = isTerminalTranscriptUpdate(event.payload);

      if (isTerminalUpdate) {
        refreshTakenOverTranscriptNow(event.payload.updatedAt, {
          allowDuringPromptPolling: true,
          fullTranscript: true
        });
      } else {
        scheduleTakenOverTranscriptRefresh(event.payload.updatedAt, {
          allowDuringPromptPolling: true,
          force: true
        });
      }
    }

    if (
      event.payload.agentSessionId === selectedAgentSessionIdRef.current &&
      event.payload.agentSessionId !== activeTakenOverAgentSessionIdRef.current
    ) {
      scheduleSelectedAgentSessionRefresh(event.payload.updatedAt);
    }

    const selectedManagedSessionId = selectedSessionRef.current?.id || selectedSessionId;

    if (
      selectedManagedSessionId &&
      isSourceUpdateForManagedSession(selectedSessionRef.current, event.payload.agentSessionId)
    ) {
      void loadSessionRef.current(
        selectedManagedSessionId,
        buildManagedSessionLoadOptionsForTab(activeTabRef.current, {
          silent: true
        })
      );
    }

    return;
  }

  if (event.type === "agent.session.reviewed") {
    startTransition(() => {
      store.markAgentSessionReviewedAt(
        event.payload.agentSessionId,
        event.payload.reviewedAt
      );
    });

    invalidateAgentSessionSummaries();
    return;
  }

  if (event.type === "agent.session.turn.finished") {
    if (event.payload.status === "completed") {
      if (event.payload.agentSessionId === selectedAgentSessionIdRef.current) {
        void agentSessionsApi.markReviewed(event.payload.agentSessionId)
          .then((result) => {
            startTransition(() => {
              store.markAgentSessionReviewedAt(result.agentSessionId, result.reviewedAt);
            });
          })
          .catch(() => undefined);
      } else {
        store.markAgentSessionReadyForReview(event.payload.agentSessionId);
      }
    }

    const shouldRefreshTakenOverAgentSession =
      event.payload.agentSessionId === activeTakenOverAgentSessionIdRef.current &&
      usesTakenOverAgentTranscript(activeTabRef.current);

    const selectedManagedSessionId = event.payload.managedSessionId;

    if (
      selectedManagedSessionId &&
      (
        selectedManagedSessionId === selectedSessionId ||
        selectedManagedSessionId === selectedSessionRef.current?.id
      )
    ) {
      void loadSessionRef.current(
        selectedManagedSessionId,
        buildManagedSessionLoadOptionsForTab(activeTabRef.current, {
          silent: true
        })
      );
    }

    if (shouldRefreshTakenOverAgentSession) {
      const terminalRefreshOptions = {
        allowDuringPromptPolling: true,
        force: true,
        fullTranscript: true
      };

      refreshTakenOverTranscriptNow(undefined, terminalRefreshOptions);
    }

    if (
      event.payload.agentSessionId === selectedAgentSessionIdRef.current &&
      event.payload.agentSessionId !== activeTakenOverAgentSessionIdRef.current
    ) {
      scheduleSelectedAgentSessionRefresh();
    }

    invalidateAgentSessionSummaries();

    return;
  }

  startTransition(() => {
    store.mergeOverviewSession(event.payload);
  });

  const isSelectedManagedSession =
    event.payload.id === selectedSessionIdRef.current ||
    event.payload.id === selectedSessionRef.current?.id;

  if (isSelectedManagedSession) {
    const shouldReloadSelectedSession =
      !selectedSessionRef.current ||
      hasManagedSessionLifecycleDifference(selectedSessionRef.current, event.payload);

    startTransition(() => {
      store.mergeSelectedSessionSummary(event.payload, {
        includePreview: event.type === "session.preview"
      });
    });

    if (shouldReloadSelectedSession) {
      void loadSessionRef.current(
        event.payload.id,
        buildManagedSessionLoadOptionsForTab(activeTabRef.current, {
          silent: true
        })
      );
    }

    if (
      isManagedSessionUpdateForActiveSource(
        event.payload,
        activeTakenOverAgentSessionIdRef.current
      ) &&
      usesTakenOverAgentTranscript(activeTabRef.current)
    ) {
      if (isTerminalManagedSessionUpdate(event.payload)) {
        refreshTakenOverTranscriptNow(undefined, {
          allowDuringPromptPolling: true,
          force: true,
          fullTranscript: true
        });
      } else {
        scheduleTakenOverTranscriptRefresh(undefined, {
          allowDuringPromptPolling: true
        });
      }
    }
  }
}
