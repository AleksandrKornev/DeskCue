import { randomUUID } from "node:crypto";

import type {
  ServerEvent,
  SessionDetail,
  SessionLogLine,
  SessionSummary
} from "@deskcue/protocol";
import { deriveActionRequestFromLog } from "#sessions/actionRequest/sessionActionRequest";

import {
  MAX_LOG_TEXT_LENGTH,
  MAX_SESSION_LOG_LINES,
  truncateSessionLogText
} from "./sessionLogs.ts";

export type SessionLogAppendCallbacks = {
  emitServerEvent: (event: ServerEvent) => void;
  getSession: (sessionId: string) => SessionDetail | null;
  schedulePersistState: () => void;
  toSummary: (session: SessionDetail) => SessionSummary;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

export function appendSessionLog(
  callbacks: SessionLogAppendCallbacks,
  sessionId: string,
  stream: SessionLogLine["stream"],
  text: string,
  timestamp = new Date().toISOString()
): void {
  const session = callbacks.getSession(sessionId);
  if (!session || !text) {
    return;
  }

  const normalizedText =
    text.length > MAX_LOG_TEXT_LENGTH ? truncateSessionLogText(text) : text;

  const log: SessionLogLine = {
    id: randomUUID(),
    timestamp,
    stream,
    text: normalizedText
  };

  const nextActionRequest = deriveActionRequestFromLog({
    current: session.actionRequest ?? null,
    text: normalizedText,
    timestamp
  });

  const nextLogs =
    session.logs.length >= MAX_SESSION_LOG_LINES
      ? [...session.logs.slice(-(MAX_SESSION_LOG_LINES - 1)), log]
      : [...session.logs, log];
  const actionRequestChanged =
    nextActionRequest !== undefined && nextActionRequest !== (session.actionRequest ?? null);

  callbacks.updateSession(sessionId, {
    logs: nextLogs,
    ...(nextActionRequest !== undefined ? { actionRequest: nextActionRequest } : {})
  });
  callbacks.emitServerEvent({
    type: "session.log",
    payload: {
      sessionId,
      log
    }
  });
  if (actionRequestChanged) {
    const updatedSession = callbacks.getSession(sessionId);
    if (updatedSession) {
      callbacks.emitServerEvent({
        type: "session.updated",
        payload: callbacks.toSummary(updatedSession)
      });
    }
  }
  callbacks.schedulePersistState();
}
