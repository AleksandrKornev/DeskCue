import {
  ProtocolSchemaError,
  readProtocolObject
} from "./schema.ts";
import type {
  AgentKind,
  AgentSessionSummary,
  SessionLogLine,
  SessionSummary,
  WorkspaceSummary
} from "./sessions.ts";
import { validateServerEventPayload } from "./validation/serverEvents.ts";

export const DESKCUE_PROTOCOL_VERSION = 1;
export const DESKCUE_PROTOCOL_CAPABILITIES = [
  "connection.epoch",
  "realtime.cursor-ack",
  "realtime.protocol-hello",
  "transcript.bounded-hydration"
] as const;

export type DeskCueProtocolCapability = typeof DESKCUE_PROTOCOL_CAPABILITIES[number];

export interface ProtocolHelloPayload {
  capabilities: DeskCueProtocolCapability[];
  version: number;
}

export interface AgentSessionTurnFinishedPayload {
  agentId: AgentKind;
  agentLabel: string;
  agentSessionId: string;
  answer?: string | null;
  completedAt: string;
  durationMs?: number | null;
  managedSessionId?: string | null;
  sourceSessionId: string;
  startedAt?: string | null;
  status: "completed" | "failed" | "interrupted";
  title: string;
  workspaceName: string | null;
  workspacePath: string | null;
}

export interface AgentSessionTranscriptUpdatedPayload {
  agentId: AgentKind;
  agentLabel: string;
  agentSessionId: string;
  latestEntryId: string | null;
  sourceSessionId: string;
  transcriptLength: number;
  turnState?: AgentSessionSummary["turnState"];
  updatedAt: string;
  workState: AgentSessionSummary["workState"];
}

export type ClientEvent =
  | {
      clientId?: string;
      type: "presence";
      sessionId: string | null;
      sessionTab?: string | null;
    }
  | {
      clientId?: string;
      cursor: string;
      type: "ack";
    };

export function parseClientEvent(value: unknown): ClientEvent {
  const body = readProtocolObject(value);

  if (body.type === "ack") {
    if (
      (body.clientId !== undefined && typeof body.clientId !== "string") ||
      typeof body.cursor !== "string" ||
      body.cursor.trim() === ""
    ) {
      throw new ProtocolSchemaError("Client ack event must include a cursor.");
    }

    return {
      ...(body.clientId ? { clientId: body.clientId } : {}),
      cursor: body.cursor,
      type: "ack"
    };
  }

  if (
    body.type !== "presence" ||
    (body.clientId !== undefined && typeof body.clientId !== "string") ||
    (body.sessionId !== null && typeof body.sessionId !== "string") ||
    (
      body.sessionTab !== undefined &&
      body.sessionTab !== null &&
      typeof body.sessionTab !== "string"
    )
  ) {
    throw new ProtocolSchemaError("Client event must be a presence event.");
  }

  return {
    ...(body.clientId ? { clientId: body.clientId } : {}),
    type: "presence",
    sessionId: body.sessionId,
    ...(body.sessionTab !== undefined ? { sessionTab: body.sessionTab } : {})
  };
}

type ServerEventCursor = {
  cursor?: string;
};

export type ServerEvent = (
    | {
      type: "protocol.hello";
      payload: ProtocolHelloPayload;
    }

    | {
      type: "workspace.created";
      payload: WorkspaceSummary;
    }

    | {
        type: "agent.session.updated";
        payload: AgentSessionSummary;
      }
    | {
        type: "agent.session.turn.finished";
        payload: AgentSessionTurnFinishedPayload;
      }
    | {
        type: "agent.session.transcript.updated";
        payload: AgentSessionTranscriptUpdatedPayload;
      }
    | {
        type: "agent.session.reviewed";
        payload: {
          agentSessionId: string;
          reviewedAt: string;
        };
      }
    | {
        type: "local.llm.chat.updated";
        payload: {
          chatId: string;
          terminal: boolean;
        };
      }
    | {
        type: "local.llm.chat.finished";
        payload: {
          answer: string | null;
          chatId: string;
          completedAt: string;
          error: string | null;
          model: string;
          runtimeId: "ollama" | "lm-studio";
          status: "completed" | "failed" | "interrupted";
          title: string;
        };
      }
    | {
        type: "local.llm.chat.approval.required";
        payload: {
          action: "apply_unified_diff" | "run_workspace_command";
          chatId: string;
          model: string;
          requestedAt: string;
          runtimeId: "ollama" | "lm-studio";
          summary: string;
          title: string;
        };
      }
    | {
        type: "session.created" | "session.updated" | "session.git" | "session.preview";
        payload: SessionSummary;
      }
    | {
        type: "session.log";
        payload: {
          sessionId: string;
          log: SessionLogLine;
        };
      }
  ) & ServerEventCursor;

const SERVER_EVENT_TYPES = new Set<ServerEvent["type"]>([
  "protocol.hello",
  "workspace.created",
  "agent.session.updated",
  "agent.session.turn.finished",
  "agent.session.transcript.updated",
  "agent.session.reviewed",
  "local.llm.chat.updated",
  "local.llm.chat.finished",
  "local.llm.chat.approval.required",
  "session.created",
  "session.updated",
  "session.git",
  "session.preview",
  "session.log"
]);

export function parseServerEvent(value: unknown): ServerEvent {
  const event = readProtocolObject(value);

  if (typeof event.type !== "string" || !SERVER_EVENT_TYPES.has(event.type as ServerEvent["type"])) {
    throw new ProtocolSchemaError("Server event type is invalid.");
  }

  if (event.cursor !== undefined && (
    typeof event.cursor !== "string" || event.cursor.trim() === ""
  )) {
    throw new ProtocolSchemaError("Server event cursor must be a non-empty string when provided.");
  }

  const payload = readProtocolObject(event.payload);

  validateServerEventPayload(event.type as ServerEvent["type"], payload);

  return event as ServerEvent;
}

export function isCompatibleProtocolHello(
  payload: ProtocolHelloPayload,
  requiredCapabilities: readonly DeskCueProtocolCapability[] = DESKCUE_PROTOCOL_CAPABILITIES
) {
  return isCompatibleProtocolMetadata(
    payload.version,
    payload.capabilities,
    requiredCapabilities
  );
}

export function isCompatibleProtocolMetadata(
  version: unknown,
  capabilities: unknown,
  requiredCapabilities: readonly DeskCueProtocolCapability[] = DESKCUE_PROTOCOL_CAPABILITIES
) {
  return (
    version === DESKCUE_PROTOCOL_VERSION &&
    Array.isArray(capabilities) &&
    capabilities.every((capability) => typeof capability === "string") &&
    requiredCapabilities.every((capability) => capabilities.includes(capability))
  );
}
