export const CLOUD_RELAY_PROTOCOL_VERSION = 1 as const;
export const CLOUD_RELAY_CAPABILITY = "session.summary" as const;
export const CLOUD_REMOTE_READ_CAPABILITY = "deskcue.read" as const;
export const CLOUD_REMOTE_FILES_CAPABILITY = "deskcue.files" as const;
export const CLOUD_REMOTE_CONTROL_CAPABILITY = "deskcue.control" as const;
export const CLOUD_REMOTE_REALTIME_CAPABILITY = "deskcue.realtime" as const;
export const CLOUD_REMOTE_PREVIEW_CAPABILITY = "deskcue.preview" as const;

export const CLOUD_RELAY_CAPABILITIES = [
  CLOUD_RELAY_CAPABILITY,
  CLOUD_REMOTE_READ_CAPABILITY,
  CLOUD_REMOTE_FILES_CAPABILITY,
  CLOUD_REMOTE_CONTROL_CAPABILITY,
  CLOUD_REMOTE_REALTIME_CAPABILITY,
  CLOUD_REMOTE_PREVIEW_CAPABILITY
] as const;

export type CloudRelayCapability = typeof CLOUD_RELAY_CAPABILITIES[number];

export const CLOUD_RELAY_STREAM = "session-summaries" as const;
export const CLOUD_RELAY_MAX_FRAME_BYTES = 16_384;

export const CLOUD_REMOTE_READ_CHUNK_BYTES = 8 * 1024;
export const CLOUD_REMOTE_READ_MAX_REQUEST_BYTES = 256 * 1024;
export const CLOUD_REMOTE_READ_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export const CLOUD_REMOTE_READ_OPERATIONS = [
  // Overview and sessions.
  "overview.get",
  "managedSessions.get",
  "sessions.list",
  "sessions.resolveRoute",
  "sessions.get",
  "sessions.reviewed.post",

  // Transcript and change evidence.
  "transcript.view",
  "transcript.updates",
  "transcript.page",
  "transcript.entries.get",
  "transcript.entries.post",
  "changes.get",
  "changes.post",

  // Workspace and Preview resources.
  "assets.ticket.create",
  "assets.ticket.read",
  "workspace.files.list",
  "workspace.files.read",
  "managed.git.refresh",
  "preview.candidates"
] as const;

export type CloudRemoteReadOperation = typeof CLOUD_REMOTE_READ_OPERATIONS[number];

export type CloudSourceEntryRange = {
  prefix: string;
  start: number;
  end: number;
};

export type CloudAgentSessionReadInput = {
  agentSessionId: string;
  baseItemKey?: string | null;
  baseSourceEntryId?: string | null;
  chatMessageTail?: number;
  fullTranscript?: boolean;
  includeSessionSummary?: boolean;
  omitTranscript?: boolean;
  overlapItemCount?: number;
  transcriptDetail?: "full" | "summary";
  transcriptTail?: number;
  waitingSince?: string | null;
};

export type CloudChangesReadInput = {
  agentSessionId: string;
  groupId: string;
  sourceEntryIds?: string[];
  sourceEntryRanges?: CloudSourceEntryRange[];
  sourceEntrySpans?: CloudSourceEntryRange[];
};

export type CloudRemoteReadOperationInputMap = {
  // Overview and sessions.
  "overview.get": { sessionLimit?: number };
  "managedSessions.get": {
    sessionId: string;
    view?: "chat" | "debug" | "diff";
    debugLogTail?: number;
  };
  "sessions.list": {
    includeLiveMetadata?: boolean;
    limit?: number;
    offset?: number;
    query?: string;
    sourceId?: string;
  };
  "sessions.resolveRoute": { cloudSessionId: string };
  "sessions.get": CloudAgentSessionReadInput;
  "sessions.reviewed.post": { agentSessionId: string };

  // Transcript and change evidence.
  "transcript.view": CloudAgentSessionReadInput;
  "transcript.updates": CloudAgentSessionReadInput;
  "transcript.page": {
    agentSessionId: string;
    beforeEntryId: string;
    limit?: number;
  };
  "transcript.entries.get": { agentSessionId: string; entryIds: string[] };
  "transcript.entries.post": { agentSessionId: string; entryIds: string[] };
  "changes.get": CloudChangesReadInput;
  "changes.post": CloudChangesReadInput;

  // Workspace and Preview resources.
  "assets.ticket.create": {
    agentSessionId?: string;
    download?: boolean;
    kind: "file" | "local_image";
    managedSessionId?: string;
    path: string;
  };
  "assets.ticket.read": { ticket: string };
  "workspace.files.list": {
    workspaceId: string;
    path?: string;
    cursor?: string | null;
    limit?: number;
  };
  "workspace.files.read": { workspaceId: string; path: string };
  "managed.git.refresh": { sessionId: string; view?: "diff" };
  "preview.candidates": { kind: "session"; ownerId: string };
};
export type CloudRemoteReadOperationInput<
  Operation extends CloudRemoteReadOperation = CloudRemoteReadOperation
> = CloudRemoteReadOperationInputMap[Operation];

export type CloudResolvedSessionRoute =
  | { kind: "agent"; sessionId: string }
  | { kind: "local_llm"; sessionId: string }
  | { kind: "managed"; sessionId: string };

export const REMOTE_CONTROL_CHUNK_BYTES = 8 * 1024;
export const REMOTE_CONTROL_MAX_REQUEST_BYTES = 64 * 1024;
export const REMOTE_CONTROL_MAX_RESPONSE_BYTES = 1024 * 1024;
export const REMOTE_CONTROL_MAX_REQUEST_CHUNKS = Math.ceil(
  REMOTE_CONTROL_MAX_REQUEST_BYTES / REMOTE_CONTROL_CHUNK_BYTES
);
export const REMOTE_CONTROL_MAX_RESPONSE_CHUNKS = Math.ceil(
  REMOTE_CONTROL_MAX_RESPONSE_BYTES / REMOTE_CONTROL_CHUNK_BYTES
);
export const REMOTE_CONTROL_OPERATIONS = [
  "source.attach",
  "managed.input",
  "managed.interrupt",
  "managed.stop",
  "preview.configure",
  "preview.stop"
] as const;
export type RemoteControlOperation = typeof REMOTE_CONTROL_OPERATIONS[number];
export type RemoteControlOperationInputMap = {
  "source.attach": { agentSessionId: string; prompt?: string };
  "managed.input": { sessionId: string; input: string };
  "managed.interrupt": { sessionId: string };
  "managed.stop": { sessionId: string };
  "preview.configure": {
    sessionId: string;
    port: number;
    networkMode: "deskcue-host" | "device-direct";
  };
  "preview.stop": { sessionId: string };
};
export type ValidatedRemoteControlOperationInput<
  Operation extends RemoteControlOperation = RemoteControlOperation
> = RemoteControlOperationInputMap[Operation];
export type RemoteControlOperationInput = {
  [Operation in RemoteControlOperation]: {
    operation: Operation;
    input: RemoteControlOperationInputMap[Operation];
  }
}[RemoteControlOperation];

export const REMOTE_REALTIME_CHUNK_BYTES = 8 * 1024;
export const REMOTE_REALTIME_MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;
export const REMOTE_REALTIME_MAX_SERVER_MESSAGE_BYTES = 2 * 1024 * 1024;
export const REMOTE_REALTIME_MAX_CLIENT_MESSAGE_CHUNKS =
  REMOTE_REALTIME_MAX_CLIENT_MESSAGE_BYTES / REMOTE_REALTIME_CHUNK_BYTES;
export const REMOTE_REALTIME_MAX_SERVER_MESSAGE_CHUNKS =
  REMOTE_REALTIME_MAX_SERVER_MESSAGE_BYTES / REMOTE_REALTIME_CHUNK_BYTES;

export type CloudSessionRuntime =
  | "codex"
  | "claude_code"
  | "ollama"
  | "lm_studio"
  | "generic_cli";

export type CloudSessionLifecycleStatus =
  | "running"
  | "read_only"
  | "stopped"
  | "done"
  | "failed";

export type CloudSessionReplyState =
  | "idle"
  | "waiting_for_agent"
  | "waiting_for_user";

export type CloudSessionDisclosureScope = "metadata_only" | "user_opt_in";

export type CloudRelaySessionSummary = {
  sessionId: string;
  runtime: CloudSessionRuntime;
  /** Safe role metadata; true when the session was spawned by a parent agent. */
  isSubagent?: boolean;
  /** Lifecycle and control availability; this does not imply that user attention is required. */
  status: CloudSessionLifecycleStatus;
  /** Only `waiting_for_user` represents a confirmed user-action requirement. */
  replyState: CloudSessionReplyState;
  updatedAt: string;
  disclosureScope: CloudSessionDisclosureScope;
  /** Bounded user-facing label shared only after explicit local opt-in. */
  displayLabel?: string;
  /** Bounded workspace basename shared only after explicit local opt-in. */
  workspaceLabel?: string;
};

export type CloudRelayEnvelope = {
  protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
  messageId: string;
  stream: typeof CLOUD_RELAY_STREAM;
  sequence: number;
  sentAt: string;
  payload: {
    type: typeof CLOUD_RELAY_CAPABILITY;
    summary: CloudRelaySessionSummary;
  };
};

export type CloudRelayHello = {
  type: "relay.hello";
  protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
  machineId: string;
  daemonVersion: string;
  capabilities: CloudRelayCapability[];
  resume: [{ stream: typeof CLOUD_RELAY_STREAM; ackedSequence: number }];
  sentAt: string;
};

export type CloudRelayWelcome = {
  type: "relay.welcome";
  protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
  connectionId: string;
  machineId: string;
  negotiatedCapabilities: CloudRelayCapability[];
  streamPositions: Array<{
    stream: typeof CLOUD_RELAY_STREAM;
    nextSequence: number;
  }>;
  heartbeatIntervalMs: number;
  maxFrameBytes: number;
  connectedAt: string;
};

export type CloudRelayRejected = {
  type: "relay.rejected";
  protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
  code:
    | "INVALID_HELLO"
    | "AUTHENTICATION_FAILED"
    | "MACHINE_REVOKED"
    | "UNSUPPORTED_PROTOCOL_VERSION"
    | "NO_COMMON_CAPABILITIES";
  retryable: boolean;
  rejectedAt: string;
};

export type CloudRelayAck = {
  type: "relay.ack";
  protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
  messageId: string;
  stream: typeof CLOUD_RELAY_STREAM;
  ackedSequence: number;
  receivedAt: string;
} & (
  | { accepted: true }
  | {
      accepted: false;
      error: {
        code:
          | "INVALID_ENVELOPE"
          | "INVALID_PAYLOAD"
          | "CAPABILITY_NOT_NEGOTIATED"
          | "CONNECTION_NOT_ACTIVE"
          | "SEQUENCE_GAP"
          | "RATE_LIMITED"
          | "INTERNAL_ERROR";
        retryable: boolean;
      };
    }
);

export type CloudRelayServerFrame =
  | CloudRelayWelcome
  | CloudRelayRejected
  | CloudRelayAck
  | CloudRemoteReadRequestFrame
  | RemoteControlRequestFrame
  | RemoteRealtimeServerFrame;

export type CloudRemoteReadRequestFrame =
  | {
      type: "remote.read.request.start";
      protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
      requestId: string;
      operation: CloudRemoteReadOperation;
      bodyBytes: number;
      chunkCount: number;
      bodySha256: string;
      deadlineAt: string;
      sentAt: string;
    }
  | {
      type: "remote.read.request.chunk";
      protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
      requestId: string;
      index: number;
      data: string;
    }
  | {
      type: "remote.read.request.end";
      protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
      requestId: string;
      bodySha256: string;
      sentAt: string;
    };

export type CloudRemoteReadResponseFrame =
  | {
      type: "remote.read.response.start";
      protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
      requestId: string;
      status: number;
      bodyBytes: number;
      chunkCount: number;
      bodySha256: string;
      sentAt: string;
    }
  | {
      type: "remote.read.response.chunk";
      protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
      requestId: string;
      index: number;
      data: string;
    }
  | {
      type: "remote.read.response.end";
      protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
      requestId: string;
      bodySha256: string;
      sentAt: string;
    };

export type RemoteControlRequestFrame =
  | {
      type: "remote.control.request.start";
      protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
      requestId: string;
      commandId: string;
      operation: RemoteControlOperation;
      bodyBytes: number;
      chunkCount: number;
      bodySha256: string;
      deadlineAt: string;
      sentAt: string;
    }
  | {
      type: "remote.control.request.chunk";
      protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
      requestId: string;
      index: number;
      data: string;
    }
  | {
      type: "remote.control.request.end";
      protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
      requestId: string;
      bodySha256: string;
      sentAt: string;
    };

export type RemoteControlResponseFrame =
  | {
      type: "remote.control.response.start";
      protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
      requestId: string;
      status: number;
      bodyBytes: number;
      chunkCount: number;
      bodySha256: string;
      sentAt: string;
    }
  | {
      type: "remote.control.response.chunk";
      protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
      requestId: string;
      index: number;
      data: string;
    }
  | {
      type: "remote.control.response.end";
      protocolVersion: typeof CLOUD_RELAY_PROTOCOL_VERSION;
      requestId: string;
      bodySha256: string;
      sentAt: string;
    };

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

/** Every frame that the DeskCue daemon may send to the Cloud relay. */
export type CloudRelayClientFrame =
  | CloudRelayHello
  | (CloudRelayEnvelope & { type?: never })
  | CloudRemoteReadResponseFrame
  | RemoteControlResponseFrame
  | RemoteRealtimeClientFrame;

export type CloudConnectorState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "degraded"
  | "revoked";

export type CloudConnectionStatusResponse = {
  connectorIncluded: true;
  connected: boolean;
  enabled: boolean;
  state: CloudConnectorState;
  cloudOrigin: string | null;
  displayName: string | null;
  machineId: string | null;
  lastConnectedAt: string | null;
  lastErrorCode: string | null;
  pendingEventCount: number;
  remoteReadEnabled: boolean;
  remoteFilesEnabled: boolean;
  remoteControlEnabled: boolean;
  remotePreviewEnabled: boolean;
  sessionLabelDisclosureEnabled: boolean;
};

export type UpdateCloudSessionDisclosureInput = {
  enabled: boolean;
};

export type UpdateCloudPermissionsInput = {
  allowRemoteRead: boolean;
  allowRemoteFiles: boolean;
  allowRemoteControl: boolean;
  allowRemotePreview: boolean;
};

export type ConnectCloudInput = {
  cloudOrigin: string;
  enrollmentTicket: string;
  displayName: string;
  allowRemoteRead: boolean;
  allowRemoteFiles: boolean;
  allowRemoteControl: boolean;
  allowRemotePreview: boolean;
};

export type StartCloudEnrollmentAttemptInput = Omit<
  ConnectCloudInput,
  "enrollmentTicket"
>;

export type CloudEnrollmentAttemptStatus =
  | "pending"
  | "failed"
  | "expired";

export type CloudEnrollmentAttempt = {
  attemptId: string;
  cloudOrigin: string;
  displayName: string;
  verificationUrl: string;
  expiresAt: string;
  pollIntervalMs: number;
  status: CloudEnrollmentAttemptStatus;
  lastErrorCode: string | null;
};

export type CloudEnrollmentAttemptResponse = {
  attempt: CloudEnrollmentAttempt | null;
};
