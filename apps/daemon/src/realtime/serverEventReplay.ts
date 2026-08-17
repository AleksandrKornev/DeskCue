import { Buffer } from "node:buffer";

import type { ServerEvent } from "@deskcue/protocol";

import { recordWebSocketBufferedEvents, recordWebSocketDroppedEvent } from "./live/metrics.ts";

export const SERVER_EVENT_REPLAY_LIMIT = 512;
export const SERVER_EVENT_REPLAY_BYTE_LIMIT = 1024 * 1024;
export const SERVER_EVENT_REPLAY_EVENT_BYTE_LIMIT = 128 * 1024;

type BufferedServerEvent = {
  bytes: number;
  event: ServerEvent;
};

function shouldBufferServerEvent(event: ServerEvent) {
  return event.type !== "session.log";
}

export class ServerEventReplayBuffer {
  private readonly replayEvents: BufferedServerEvent[] = [];
  private replayBytes = 0;
  private latestCursor = 0;

  assignCursor(event: ServerEvent): ServerEvent {
    this.latestCursor += 1;
    const eventWithCursor = {
      ...event,
      cursor: String(this.latestCursor)
    } as ServerEvent;

    if (shouldBufferServerEvent(eventWithCursor)) {
      const bytes = Buffer.byteLength(JSON.stringify(eventWithCursor));
      if (bytes <= SERVER_EVENT_REPLAY_EVENT_BYTE_LIMIT) {
        this.replayEvents.push({ bytes, event: eventWithCursor });
        this.replayBytes += bytes;
      } else {
        recordWebSocketDroppedEvent();
      }

      while (
        this.replayEvents.length > SERVER_EVENT_REPLAY_LIMIT ||
        this.replayBytes > SERVER_EVENT_REPLAY_BYTE_LIMIT
      ) {
        const removed = this.replayEvents.shift();
        this.replayBytes = Math.max(0, this.replayBytes - (removed?.bytes ?? 0));
        recordWebSocketDroppedEvent();
      }
      recordWebSocketBufferedEvents(this.replayEvents.length, this.replayBytes);
    }

    return eventWithCursor;
  }

  readAfter(cursor: string | null) {
    if (!cursor) {
      return [];
    }

    const cursorValue = Number(cursor);
    if (!Number.isSafeInteger(cursorValue) || cursorValue < 0) {
      return [];
    }

    return this.replayEvents.map(({ event }) => event).filter((event) => {
      const eventCursor = Number(event.cursor);
      return Number.isSafeInteger(eventCursor) && eventCursor > cursorValue;
    });
  }

  clear() {
    this.replayEvents.length = 0;
    this.replayBytes = 0;
    this.latestCursor = 0;
    recordWebSocketBufferedEvents(0, 0);
  }
}

export function readReplayCursorFromRequestUrl(requestUrl: string | undefined) {
  if (!requestUrl) {
    return null;
  }

  try {
    const value = new URL(requestUrl, "http://deskcue.local").searchParams.get("afterCursor");
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function readClientIdFromRequestUrl(requestUrl: string | undefined) {
  if (!requestUrl) {
    return null;
  }

  try {
    const value = new URL(requestUrl, "http://deskcue.local").searchParams.get("clientId");
    return value?.trim() || null;
  } catch {
    return null;
  }
}
