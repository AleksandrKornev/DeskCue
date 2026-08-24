import type {
  AgentSessionTurnFinishedPayload,
  ServerEvent,
  SessionActionRequest,
  SessionSummary
} from "@deskcue/protocol";

import { formatAgentLabel, formatExitCode, truncateForPush } from "./notificationFormatters.ts";
import type { NotificationPayload } from "../state/notificationTypes.ts";

export function buildSessionFinishedNotification(session: SessionSummary): NotificationPayload {
  const done = session.status === "done";

  return {
    body: `${session.workspaceName}: ${done ? "Completed" : "Failed"}${formatExitCode(session.exitCode)}`,
    data: {
      notificationKind: done ? "session.finished" : "session.failed",
      sessionId: session.id
    },
    tag: `deskcue-session-${session.id}-${session.finishedAt ?? session.status}`,
    title: done ? "DeskCue: task finished" : "DeskCue: task failed",
    url: `/sessions/${session.id}/overview`
  };
}

export function buildAgentTurnFinishedNotification(
  payload: AgentSessionTurnFinishedPayload
): NotificationPayload {
  return {
    body: payload.status === "completed"
      ? `${payload.agentLabel}: agent finished the task`
      : `${payload.agentLabel}: agent stopped before finishing`,
    data: {
      agentSessionId: payload.agentSessionId,
      agentLabel: payload.agentLabel,
      answer: payload.answer ?? null,
      completedAt: payload.completedAt,
      durationMs: payload.durationMs ?? null,
      managedSessionId: payload.managedSessionId ?? null,
      notificationKind: "agent.turn.finished",
      sourceSessionId: payload.sourceSessionId,
      startedAt: payload.startedAt ?? null,
      status: payload.status,
      workspaceName: payload.workspaceName
    },
    tag: `deskcue-agent-session-${payload.agentSessionId}-${payload.completedAt}`,
    title: `DeskCue: ${payload.title}`,
    url: payload.managedSessionId
      ? `/sessions/${encodeURIComponent(payload.managedSessionId)}/overview`
      : `/?agent=${encodeURIComponent(`${payload.agentId}:${payload.sourceSessionId}`)}`
  };
}

export function buildLocalLlmFinishedNotification(
  payload: Extract<ServerEvent, { type: "local.llm.chat.finished" }>["payload"]
): NotificationPayload {
  const runtimeLabel = payload.runtimeId === "lm-studio" ? "LM Studio" : "Ollama";

  return {
    body: payload.status === "completed"
      ? `${runtimeLabel}: response completed`
      : `${runtimeLabel}: response ${payload.status}`,
    data: {
      agentLabel: runtimeLabel,
      answer: payload.answer,
      error: payload.error,
      notificationKind: "agent.turn.finished",
      status: payload.status === "completed" ? "completed" : "interrupted"
    },
    tag: `deskcue-local-llm-${payload.chatId}-${payload.completedAt}`,
    title: `DeskCue: ${payload.title}`,
    url: `/local-llm/chats/${payload.chatId}`
  };
}

export function buildLocalLlmApprovalNotification(
  payload: Extract<ServerEvent, { type: "local.llm.chat.approval.required" }>["payload"]
): NotificationPayload {
  const runtimeLabel = payload.runtimeId === "lm-studio" ? "LM Studio" : "Ollama";

  return {
    body: `${runtimeLabel}: approve ${payload.summary}`,
    data: {
      action: payload.action,
      agentLabel: runtimeLabel,
      notificationKind: "approval.required",
      reason: payload.summary
    },
    tag: `deskcue-local-llm-action-${payload.chatId}-${payload.requestedAt}`,
    title: `DeskCue: approval needed — ${payload.title}`,
    url: `/local-llm/chats/${payload.chatId}`
  };
}

export function buildSessionActionNotification(
  session: SessionSummary,
  actionRequest: SessionActionRequest
): NotificationPayload {
  const commandText = actionRequest.command
    ? truncateForPush(actionRequest.command, 92)
    : "Agent is waiting for approval.";
  return {
    body: `${session.workspaceName}: approve or reject ${commandText}`,
    data: {
      actionKind: actionRequest.kind,
      agentLabel: formatAgentLabel(session.adapterId),
      notificationKind: "approval.required",
      reason: actionRequest.reason ?? actionRequest.command ?? null,
      sessionId: session.id,
      workspaceName: session.workspaceName
    },
    tag: `deskcue-session-action-${session.id}-${actionRequest.requestedAt}`,
    title: "DeskCue: approval needed",
    url: `/sessions/${session.id}/overview`
  };
}
