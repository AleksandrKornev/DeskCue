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
    options?: { allowDuringPromptPolling?: boolean; fullTranscript?: boolean }
  ) => void;
  scheduleTakenOverTranscriptRefresh: (
    updatedAt?: string | null,
    options?: { allowDuringPromptPolling?: boolean }
  ) => void;
  scheduleSelectedAgentSessionRefresh: (updatedAt?: string | null) => void;
  selectedAgentSessionIdRef: MutableRefObject<string>;
  selectedSessionIdRef: MutableRefObject<string>;
  selectedSessionLogQueue: SelectedSessionLogQueue;
  selectedSessionRef: MutableRefObject<SessionDetail | null>;
  store: DashboardStore;
}

function invalidateAgentSessionSummaries() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AGENT_SESSIONS_INVALIDATED_EVENT));
  }
}

function isTerminalManagedSessionUpdate(session: SessionSummary) {
  return session.sourceSessionId !== null && session.status !== "running";
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
  if (!Number.isNaN(currentUpdatedAt) && !Number.isNaN(updateUpdatedAt)) {
    return currentUpdatedAt > updateUpdatedAt;
  }

  return current.updatedAt > update.updatedAt;
}

function isTerminalUpdateForCurrentTurn(
  current: AgentSessionDetail,
  update: AgentSessionTranscriptUpdatedPayload
) {
  const nextTurnState = update.turnState;
  if (
    !nextTurnState ||
    nextTurnState.phase === "active" ||
    !current.turnState?.fingerprint
  ) {
    return false;
  }

  return current.turnState.fingerprint === nextTurnState.fingerprint;
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
  if (event.type === "protocol.hello") {
    return;
  }

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
      if (event.payload.workState === "running") {
        store.clearAgentSessionReadyForReview(event.payload.id);
      }
    });

    const shouldRefreshSelectedAgentSession =
      event.payload.id === selectedAgentSessionIdRef.current &&
      event.payload.id !== activeTakenOverAgentSessionIdRef.current;

    if (shouldRefreshSelectedAgentSession) {
      scheduleSelectedAgentSessionRefresh(event.payload.updatedAt);
    }

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
      if (event.payload.workState === "running") {
        store.clearAgentSessionReadyForReview(event.payload.agentSessionId);
      }
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
          allowDuringPromptPolling: true
        });
      }
    }

    if (
      event.payload.agentSessionId === selectedAgentSessionIdRef.current &&
      event.payload.agentSessionId !== activeTakenOverAgentSessionIdRef.current
    ) {
      scheduleSelectedAgentSessionRefresh(event.payload.updatedAt);
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

  if (event.payload.id === selectedSessionIdRef.current) {
    if (!selectedSessionRef.current) {
      loadSessionRef.current(
        event.payload.id,
        buildManagedSessionLoadOptionsForTab(activeTabRef.current, {
          silent: true
        })
      );
    } else {
      startTransition(() => {
        store.mergeSelectedSessionSummary(event.payload, {
          includePreview: event.type === "session.preview"
        });
      });
    }

    if (
      activeTakenOverAgentSessionIdRef.current &&
      usesTakenOverAgentTranscript(activeTabRef.current)
    ) {
      if (isTerminalManagedSessionUpdate(event.payload)) {
        refreshTakenOverTranscriptNow(undefined, {
          allowDuringPromptPolling: true,
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
