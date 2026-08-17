import {
  CLOUD_RELAY_CAPABILITIES,
  CLOUD_RELAY_MAX_FRAME_BYTES,
  CLOUD_RELAY_PROTOCOL_VERSION,
  CLOUD_RELAY_STREAM,
  CLOUD_REMOTE_READ_CHUNK_BYTES,
  CLOUD_REMOTE_READ_MAX_REQUEST_BYTES,
  CLOUD_REMOTE_READ_MAX_RESPONSE_BYTES,
  CLOUD_REMOTE_READ_OPERATIONS,
  REMOTE_CONTROL_CHUNK_BYTES,
  REMOTE_CONTROL_MAX_REQUEST_BYTES,
  REMOTE_CONTROL_MAX_RESPONSE_BYTES,
  REMOTE_CONTROL_OPERATIONS,
  REMOTE_REALTIME_CHUNK_BYTES,
  REMOTE_REALTIME_MAX_CLIENT_MESSAGE_BYTES,
  REMOTE_REALTIME_MAX_SERVER_MESSAGE_BYTES
} from "./types.ts";
import type {
  CloudRemoteReadOperation,
  CloudRemoteReadOperationInputMap,
  RemoteControlOperation,
  RemoteControlOperationInputMap
} from "./types.ts";
import {
  CLOUD_PREVIEW_CHUNK_BYTES,
  CLOUD_PREVIEW_FRAME_TYPES,
  CLOUD_PREVIEW_HTTP_MAX_REQUEST_BYTES,
  CLOUD_PREVIEW_HTTP_MAX_RESPONSE_BYTES,
  CLOUD_PREVIEW_MAX_CREDIT_BYTES,
  CLOUD_PREVIEW_MAX_FRAME_BYTES,
  CLOUD_PREVIEW_MAX_HEADER_BYTES,
  CLOUD_PREVIEW_MAX_HEADER_COUNT,
  CLOUD_PREVIEW_MAX_HTTP_STREAMS,
  CLOUD_PREVIEW_MAX_PATH_BYTES,
  CLOUD_PREVIEW_MAX_WS_STREAMS,
  CLOUD_PREVIEW_PROTOCOL_VERSION,
  CLOUD_PREVIEW_WS_MAX_MESSAGE_BYTES
} from "./preview.ts";

type RemoteControlFixtureMap = {
  readonly [Operation in RemoteControlOperation]: {
    readonly commandId: string;
    readonly input: RemoteControlOperationInputMap[Operation];
  };
};

const remoteReadInputs = {
  "overview.get": { sessionLimit: 16 },
  "managedSessions.get": {
    sessionId: "managed-contract-v1",
    view: "chat",
    debugLogTail: 25
  },
  "sessions.list": {
    includeLiveMetadata: true,
    limit: 8,
    offset: 0,
    query: "contract",
    sourceId: "codex"
  },
  "sessions.resolveRoute": {
    cloudSessionId: `sess_${"a".repeat(64)}`
  },
  "sessions.get": {
    agentSessionId: "agent-session:contract-v1",
    chatMessageTail: 20,
    includeSessionSummary: true,
    transcriptDetail: "summary"
  },
  "sessions.reviewed.post": {
    agentSessionId: "agent-session:contract-v1"
  },
  "transcript.view": {
    agentSessionId: "agent-session:contract-v1",
    fullTranscript: true,
    transcriptTail: 40
  },
  "transcript.updates": {
    agentSessionId: "agent-session:contract-v1",
    baseItemKey: "item-contract-v1",
    baseSourceEntryId: "entry-contract-v1",
    overlapItemCount: 4,
    waitingSince: "2026-08-11T00:00:00.000Z"
  },
  "transcript.page": {
    agentSessionId: "agent-session:contract-v1",
    beforeEntryId: "entry-contract-v1",
    limit: 20
  },
  "transcript.entries.get": {
    agentSessionId: "agent-session:contract-v1",
    entryIds: ["entry-contract-1", "entry-contract-2"]
  },
  "transcript.entries.post": {
    agentSessionId: "agent-session:contract-v1",
    entryIds: ["entry-contract-1", "entry-contract-2"]
  },
  "changes.get": {
    agentSessionId: "agent-session:contract-v1",
    groupId: "changes-contract-v1",
    sourceEntryIds: ["entry-contract-1"]
  },
  "changes.post": {
    agentSessionId: "agent-session:contract-v1",
    groupId: "changes-contract-v1",
    sourceEntryRanges: [{ prefix: "entry-contract", start: 1, end: 3 }],
    sourceEntrySpans: [{ prefix: "entry-contract", start: 5, end: 8 }]
  },
  "assets.ticket.create": {
    agentSessionId: "agent-session:contract-v1",
    kind: "local_image",
    path: "C:\\Temp\\deskcue-contract.png"
  },
  "assets.ticket.read": {
    ticket: "12345678-1234-1234-1234-123456789abc"
  },
  "workspace.files.list": {
    workspaceId: "workspace-contract-v1",
    path: "src",
    limit: 50
  },
  "workspace.files.read": {
    workspaceId: "workspace-contract-v1",
    path: "src/index.ts"
  },
  "managed.git.refresh": {
    sessionId: "managed-contract-v1",
    view: "diff"
  },
  "preview.candidates": {
    kind: "session",
    ownerId: "managed-contract-v1"
  }
} as const satisfies {
  readonly [Operation in CloudRemoteReadOperation]: CloudRemoteReadOperationInputMap[Operation];
};

const remoteControlInputs = {
  "source.attach": {
    commandId: "command_contract_attach_v1",
    input: {
      agentSessionId: "agent-session:contract-v1",
      prompt: "continue"
    }
  },
  "managed.input": {
    commandId: "command_contract_input_v1",
    input: {
      sessionId: "managed-contract-v1",
      input: "continue"
    }
  },
  "managed.interrupt": {
    commandId: "command_contract_interrupt_v1",
    input: {
      sessionId: "managed-contract-v1"
    }
  },
  "managed.stop": {
    commandId: "command_contract_stop_v1",
    input: {
      sessionId: "managed-contract-v1"
    }
  },
  "preview.configure": {
    commandId: "command_contract_preview_configure_v1",
    input: {
      sessionId: "managed-contract-v1",
      port: 5173,
      networkMode: "device-direct"
    }
  },
  "preview.stop": {
    commandId: "command_contract_preview_stop_v1",
    input: {
      sessionId: "managed-contract-v1"
    }
  }
} as const satisfies RemoteControlFixtureMap;

/**
 * Canonical JSON-serializable Cloud relay v1 contract. Private Cloud builds can
 * compare their protocol package semantically with this public OSS manifest.
 */
export const CLOUD_RELAY_V1_CONTRACT_MANIFEST = Object.freeze({
  manifestVersion: 1,
  protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
  capabilities: Object.freeze([...CLOUD_RELAY_CAPABILITIES]),
  sessionSummaryStream: CLOUD_RELAY_STREAM,
  remoteReadOperations: Object.freeze([...CLOUD_REMOTE_READ_OPERATIONS]),
  remoteControlOperations: Object.freeze([...REMOTE_CONTROL_OPERATIONS]),
  limits: Object.freeze({
    relayFrameBytes: CLOUD_RELAY_MAX_FRAME_BYTES,
    remoteReadChunkBytes: CLOUD_REMOTE_READ_CHUNK_BYTES,
    remoteReadRequestBytes: CLOUD_REMOTE_READ_MAX_REQUEST_BYTES,
    remoteReadResponseBytes: CLOUD_REMOTE_READ_MAX_RESPONSE_BYTES,
    remoteControlChunkBytes: REMOTE_CONTROL_CHUNK_BYTES,
    remoteControlRequestBytes: REMOTE_CONTROL_MAX_REQUEST_BYTES,
    remoteControlResponseBytes: REMOTE_CONTROL_MAX_RESPONSE_BYTES,
    remoteRealtimeChunkBytes: REMOTE_REALTIME_CHUNK_BYTES,
    remoteRealtimeClientMessageBytes: REMOTE_REALTIME_MAX_CLIENT_MESSAGE_BYTES,
    remoteRealtimeServerMessageBytes: REMOTE_REALTIME_MAX_SERVER_MESSAGE_BYTES,
    previewFrameBytes: CLOUD_PREVIEW_MAX_FRAME_BYTES,
    previewChunkBytes: CLOUD_PREVIEW_CHUNK_BYTES,
    previewHttpRequestBytes: CLOUD_PREVIEW_HTTP_MAX_REQUEST_BYTES,
    previewHttpResponseBytes: CLOUD_PREVIEW_HTTP_MAX_RESPONSE_BYTES,
    previewWebSocketMessageBytes: CLOUD_PREVIEW_WS_MAX_MESSAGE_BYTES,
    previewCreditBytes: CLOUD_PREVIEW_MAX_CREDIT_BYTES,
    previewPathBytes: CLOUD_PREVIEW_MAX_PATH_BYTES,
    previewHeaderBytes: CLOUD_PREVIEW_MAX_HEADER_BYTES,
    previewHeaderCount: CLOUD_PREVIEW_MAX_HEADER_COUNT,
    previewHttpStreams: CLOUD_PREVIEW_MAX_HTTP_STREAMS,
    previewWebSocketStreams: CLOUD_PREVIEW_MAX_WS_STREAMS
  }),
  realtime: Object.freeze({
    path: "/ws",
    allowedQueryParameters: Object.freeze([
      "clientId",
      "afterCursor",
      "protocolCapability",
      "protocolVersion"
    ])
  }),
  preview: Object.freeze({
    protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
    frameTypes: Object.freeze([...CLOUD_PREVIEW_FRAME_TYPES])
  })
});

/** Safe, non-secret fixtures exercising each optional v1 transport surface. */
export const CLOUD_RELAY_V1_CONTRACT_FIXTURES = Object.freeze({
  remoteReadInputs: Object.freeze(remoteReadInputs),
  remoteControlInputs: Object.freeze(remoteControlInputs),
  remoteRealtime: Object.freeze({
    path: "/ws?protocolVersion=1&protocolCapability=cursor-replay&clientId=cloud-contract-v1"
  }),
  remotePreview: Object.freeze({
    httpRequestStart: Object.freeze({
      type: "preview.http.request.start" as const,
      protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
      streamId: "preview_contract_http_01",
      owner: Object.freeze({ kind: "session" as const, ownerId: "managed-contract-v1" }),
      viewerId: "abcdefghijklmnopqrstuvwx",
      method: "GET" as const,
      path: "/",
      headers: Object.freeze([["accept", "text/html"]] as const),
      contentLength: 0,
      deadlineAt: "2026-08-11T00:00:10.000Z",
      sentAt: "2026-08-11T00:00:00.000Z"
    }),
    responseCredit: Object.freeze({
      type: "preview.flow.credit" as const,
      protocolVersion: CLOUD_PREVIEW_PROTOCOL_VERSION,
      streamId: "preview_contract_http_01",
      direction: "http.response" as const,
      creditBytes: 64 * 1024,
      sentAt: "2026-08-11T00:00:00.000Z"
    })
  })
});

export type CloudRelayV1ContractManifest = typeof CLOUD_RELAY_V1_CONTRACT_MANIFEST;
export type CloudRelayV1ContractFixtures = typeof CLOUD_RELAY_V1_CONTRACT_FIXTURES;
