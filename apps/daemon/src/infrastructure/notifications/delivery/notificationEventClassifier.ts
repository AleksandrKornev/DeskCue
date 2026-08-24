import type {
  NotificationEventKind,
  NotificationProviderKind,
  ServerEvent
} from "@deskcue/protocol";

import {
  buildAgentTurnFinishedNotification,
  buildLocalLlmApprovalNotification,
  buildLocalLlmFinishedNotification,
  buildSessionActionNotification,
  buildSessionFinishedNotification
} from "./notificationPayloads.ts";
import { buildLegacySessionWebhookPayload } from "../providers/sessionWebhookNotifier.ts";
import type { NotificationDedupeClaim, NotificationPayload } from "../state/notificationTypes.ts";

export type ClassifiedNotificationEvent = {
  claim: NotificationDedupeClaim;
  event: NotificationEventKind;
  payload: NotificationPayload;
  providersOverride?: NotificationProviderKind[];
};

export function classifyNotificationServerEvent(
  event: ServerEvent,
  legacySessionWebhookActive: boolean
): ClassifiedNotificationEvent[] {
  if (event.type === "local.llm.chat.approval.required") {
    return [{
      claim: {
        bucket: "actionRequestKeys",
        key: `${event.payload.chatId}:${event.payload.requestedAt}`
      },
      event: "approval.required",
      payload: buildLocalLlmApprovalNotification(event.payload)
    }];
  }

  if (event.type === "local.llm.chat.finished") {
    return [{
      claim: {
        bucket: "agentSessionKeys",
        key: `${event.payload.chatId}:${event.payload.status}:${event.payload.completedAt}`
      },
      event: "agent.turn.finished",
      payload: buildLocalLlmFinishedNotification(event.payload)
    }];
  }

  if (event.type === "agent.session.turn.finished") {
    return [{
      claim: {
        bucket: "agentSessionKeys",
        key: `${event.payload.agentSessionId}:${event.payload.status}:${event.payload.completedAt}`
      },
      event: "agent.turn.finished",
      payload: buildAgentTurnFinishedNotification(event.payload)
    }];
  }

  if (event.type !== "session.updated") return [];

  const session = event.payload;
  const classified: ClassifiedNotificationEvent[] = [];

  if (session.actionRequest?.kind === "approval") {
    classified.push({
      claim: {
        bucket: "actionRequestKeys",
        key: `${session.id}:${session.actionRequest.requestedAt}:${session.actionRequest.command ?? ""}`
      },
      event: "approval.required",
      payload: buildSessionActionNotification(session, session.actionRequest)
    });
  }

  if (session.status === "stopped" && session.finishedAt === null) return classified;

  if (
    session.status !== "done" &&
    session.status !== "failed" &&
    (session.status !== "stopped" || !legacySessionWebhookActive)
  ) {
    return classified;
  }

  const payload = buildSessionFinishedNotification(session);

  if (legacySessionWebhookActive) payload.webhookBody = buildLegacySessionWebhookPayload(session);

  classified.push({
    claim: {
      bucket: "sessionKeys",
      key: `${session.id}:${session.status}:${session.finishedAt ?? ""}`
    },
    event: session.status === "failed" ? "session.failed" : "session.finished",
    payload,
    providersOverride: session.status === "stopped" ? ["webhook"] : undefined
  });
  return classified;
}
