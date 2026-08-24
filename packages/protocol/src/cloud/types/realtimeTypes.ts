import type { CLOUD_RELAY_PROTOCOL_VERSION } from "../types.ts";

export type RemoteRealtimeOpenMessage = {
  type: "remote.realtime.open";
  protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
  streamId: string;
  path: string;
  deadlineAt: string;
  sentAt: string;
};

export type RemoteRealtimeOpenedMessage = {
  type: "remote.realtime.opened";
  protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
  streamId: string;
  openedAt: string;
};

export type RemoteRealtimeClientMessageStart = {
  type: "remote.realtime.client.message.start";
  protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
  streamId: string;
  messageId: string;
  bodyBytes: number;
  chunkCount: number;
  bodySha256: string;
  sentAt: string;
};

export type RemoteRealtimeClientMessageChunk = {
  type: "remote.realtime.client.message.chunk";
  protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
  streamId: string;
  messageId: string;
  index: number;
  data: string;
};

export type RemoteRealtimeClientMessageEnd = {
  type: "remote.realtime.client.message.end";
  protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
  streamId: string;
  messageId: string;
  bodySha256: string;
  sentAt: string;
};

export type RemoteRealtimeServerMessageStart = Omit<RemoteRealtimeClientMessageStart, "type"> & {
  type: "remote.realtime.server.message.start";
};

export type RemoteRealtimeServerMessageChunk = Omit<RemoteRealtimeClientMessageChunk, "type"> & {
  type: "remote.realtime.server.message.chunk";
};

export type RemoteRealtimeServerMessageEnd = Omit<RemoteRealtimeClientMessageEnd, "type"> & {
  type: "remote.realtime.server.message.end";
};

export type RemoteRealtimeCloseMessage = {
  type: "remote.realtime.close";
  protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
  streamId: string;
  code: number;
  reason: string;
  sentAt: string;
};

export type RemoteRealtimeClosedMessage = {
  type: "remote.realtime.closed";
  protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
  streamId: string;
  code: number;
  reason: string;
  closedAt: string;
};

export type RemoteRealtimeServerFrame =
  | RemoteRealtimeOpenMessage
  | RemoteRealtimeClientMessageStart
  | RemoteRealtimeClientMessageChunk
  | RemoteRealtimeClientMessageEnd
  | RemoteRealtimeCloseMessage;

export type RemoteRealtimeClientFrame =
  | RemoteRealtimeOpenedMessage
  | RemoteRealtimeServerMessageStart
  | RemoteRealtimeServerMessageChunk
  | RemoteRealtimeServerMessageEnd
  | RemoteRealtimeClosedMessage;
