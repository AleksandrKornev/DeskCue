import {
  DESKCUE_PROTOCOL_CAPABILITIES,
  DESKCUE_PROTOCOL_VERSION,
  parseServerEvent
} from "@deskcue/protocol";
import type { ServerEvent } from "@deskcue/protocol";
import {
  buildWebSocketUrl,
  getConnectionConfig
} from "@api/connection/config";
import {
  CONNECTION_CONFIG_CHANGED_EVENT,
  emitUnauthorizedEvent,
  readConnectionEpoch
} from "@api/connection/events";
import { getDeskCueRuntime } from "@runtime";

const LIVE_UPDATES_CLIENT_ID_STORAGE_KEY = "deskcue.liveUpdatesClientId";
const LIVE_UPDATES_CURSOR_STORAGE_KEY = "deskcue.liveUpdatesCursor";
const liveUpdatesSocketScopes = new WeakMap<WebSocket, {
  generation: number;
  scope: string | null;
}>();

type StoredLiveUpdatesCursor = {
  cursor: string;
  scope: string;
};

function getLiveUpdatesClientId() {
  const existingId = sessionStorage.getItem(LIVE_UPDATES_CLIENT_ID_STORAGE_KEY);
  if (existingId) {
    return existingId;
  }

  const generatedId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  sessionStorage.setItem(LIVE_UPDATES_CLIENT_ID_STORAGE_KEY, generatedId);
  return generatedId;
}

function readLiveUpdatesScope() {
  const runtime = getDeskCueRuntime();
  if (runtime.mode === "cloud-machine") {
    return runtime.getRealtimeScope();
  }

  const config = getConnectionConfig();
  if (config.accessToken) {
    return null;
  }
  const daemonScope = config.daemonUrl || window.location.origin;
  const accessScope = config.deviceId
    ? `device:${config.deviceId}`
    : "anonymous";
  return `${daemonScope}|${accessScope}`;
}

function clearLiveUpdatesResumeState() {
  sessionStorage.removeItem(LIVE_UPDATES_CURSOR_STORAGE_KEY);
}

function readLiveUpdatesCursor(scope: string | null) {
  if (!scope) {
    sessionStorage.removeItem(LIVE_UPDATES_CURSOR_STORAGE_KEY);
    return null;
  }

  const stored = sessionStorage.getItem(LIVE_UPDATES_CURSOR_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<StoredLiveUpdatesCursor>;
    if (
      typeof parsed.cursor === "string" &&
      parsed.cursor &&
      parsed.scope === scope
    ) {
      return parsed.cursor;
    }
  } catch {
    // Legacy unscoped cursors are unsafe after switching daemon instances.
  }

  sessionStorage.removeItem(LIVE_UPDATES_CURSOR_STORAGE_KEY);
  return null;
}

function createProtocolHandshakeQuery(initial: Record<string, string>) {
  const query = new URLSearchParams(initial);
  query.set("protocolVersion", String(DESKCUE_PROTOCOL_VERSION));
  for (const capability of DESKCUE_PROTOCOL_CAPABILITIES) {
    query.append("protocolCapability", capability);
  }
  return query;
}

if (typeof window !== "undefined") {
  window.addEventListener(
    CONNECTION_CONFIG_CHANGED_EVENT,
    clearLiveUpdatesResumeState
  );
}

export function openLiveUpdatesSocket() {
  const scope = readLiveUpdatesScope();
  const query = createProtocolHandshakeQuery({
    clientId: getLiveUpdatesClientId()
  });
  const cursor = readLiveUpdatesCursor(scope);
  if (cursor) {
    query.set("afterCursor", cursor);
  }

  const socket = new WebSocket(buildWebSocketUrl(`/ws?${query.toString()}`));
  liveUpdatesSocketScopes.set(socket, {
    generation: readConnectionEpoch(),
    scope
  });
  return socket;
}

export function openAccessMonitorSocket() {
  const query = createProtocolHandshakeQuery({ mode: "access" });
  const socket = new WebSocket(buildWebSocketUrl(`/ws?${query.toString()}`));
  liveUpdatesSocketScopes.set(socket, {
    generation: readConnectionEpoch(),
    scope: null
  });
  return socket;
}

export function sendLiveSessionPresence(
  socket: WebSocket | null,
  sessionId: string,
  sessionTab?: string | null
) {
  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({
    clientId: getLiveUpdatesClientId(),
    type: "presence",
    sessionId: sessionId || null,
    sessionTab: sessionTab || null
  }));
}

export function parseLiveUpdateMessage(message: MessageEvent) {
  return parseServerEvent(JSON.parse(message.data as string));
}

export function acknowledgeLiveUpdateCursor(socket: WebSocket | null, event: ServerEvent) {
  if (!event.cursor || !socket) {
    return;
  }

  const socketState = liveUpdatesSocketScopes.get(socket);
  if (
    !socketState ||
    socketState.generation !== readConnectionEpoch() ||
    socketState.scope !== readLiveUpdatesScope()
  ) {
    return;
  }

  if (socketState.scope) {
    sessionStorage.setItem(LIVE_UPDATES_CURSOR_STORAGE_KEY, JSON.stringify({
      cursor: event.cursor,
      scope: socketState.scope
    } satisfies StoredLiveUpdatesCursor));
  }
  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({
    clientId: getLiveUpdatesClientId(),
    cursor: event.cursor,
    type: "ack"
  }));
}

export function handleLiveUpdatesClose(socket: WebSocket | null, event: CloseEvent) {
  if (event.code === 4001) {
    if (getDeskCueRuntime().mode === "cloud-machine") {
      return false;
    }
    const socketEpoch = socket
      ? liveUpdatesSocketScopes.get(socket)?.generation
      : undefined;
    return socketEpoch === undefined
      ? false
      : emitUnauthorizedEvent(socketEpoch);
  }

  return false;
}
