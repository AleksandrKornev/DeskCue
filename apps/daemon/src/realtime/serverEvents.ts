import type { ServerEvent, SessionDetail, SessionSummary } from "@deskcue/protocol";
import { DESKCUE_PROTOCOL_CAPABILITIES, DESKCUE_PROTOCOL_VERSION } from "@deskcue/protocol";

export function createProtocolHelloEvent(): ServerEvent {
  return {
    type: "protocol.hello",
    payload: {
      capabilities: [...DESKCUE_PROTOCOL_CAPABILITIES],
      version: DESKCUE_PROTOCOL_VERSION
    }
  };
}

export function decorateServerEvent(
  event: ServerEvent,
  decorateSession: <T extends SessionSummary | SessionDetail>(session: T) => T
): ServerEvent {
  if (
    event.type === "session.created" ||
    event.type === "session.updated" ||
    event.type === "session.git" ||
    event.type === "session.preview"
  ) {
    return {
      ...event,
      payload: decorateSession(event.payload)
    };
  }

  return event;
}

/**
 * Realtime events are invalidations, not a second response transport. Keep the
 * completed answer in the notification pipeline and hydrate chat contents over
 * HTTP so reconnect replay cannot retain every generated answer in memory.
 */
export function prepareServerEventForRealtime(event: ServerEvent): ServerEvent {
  if (event.type !== "local.llm.chat.finished" || event.payload.answer === null) {
    return event;
  }

  return {
    ...event,
    payload: {
      ...event.payload,
      answer: null
    }
  };
}

export function serializeServerEvent(
  event: ServerEvent,
  decorateSession: <T extends SessionSummary | SessionDetail>(session: T) => T
) {
  return JSON.stringify(decorateServerEvent(event, decorateSession));
}
