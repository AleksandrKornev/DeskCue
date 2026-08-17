import type {
  CloudRelayClientFrame,
  CloudRemoteReadOperation,
  RemoteControlOperation
} from "@deskcue/protocol/cloud";
import type {
  CloudConnectorProfile,
  SqliteCloudConnectorStore
} from "#persistence/cloud/cloudConnectorStore";

import type { CloudRemoteControlResult } from "../cloudRemoteControlExecutor.ts";
import type { CloudRemoteReadResult } from "../cloudRemoteReadExecutor.ts";

export type RemoteReadExecutor = {
  execute: (
    operation: CloudRemoteReadOperation,
    input: unknown,
    shutdownSignal?: AbortSignal
  ) => Promise<CloudRemoteReadResult>;
};

export type RemoteControlExecutor = {
  execute: (
    operation: RemoteControlOperation,
    input: unknown,
    shutdownSignal?: AbortSignal
  ) => Promise<CloudRemoteControlResult>;
};

export type PendingRemoteReadRequest = {
  operation: CloudRemoteReadOperation;
  bodyBytes: number;
  chunkCount: number;
  bodySha256: string;
  deadlineAt: string;
  chunks: Array<Buffer | undefined>;
  expiryTimer: NodeJS.Timeout;
};

export type PendingRemoteControlRequest = {
  operation: RemoteControlOperation;
  commandId: string;
  bodyBytes: number;
  chunkCount: number;
  bodySha256: string;
  deadlineAt: string;
  chunks: Array<Buffer | undefined>;
  expiryTimer: NodeJS.Timeout;
};

export type CloudRemoteRequestHandlerOptions<TConnection extends object> = {
  store: SqliteCloudConnectorStore;
  readExecutor: RemoteReadExecutor;
  controlExecutor: RemoteControlExecutor;
  sendCloudFrame: (connection: TConnection, frame: CloudRelayClientFrame) => boolean;
  closeConnection: (connection: TConnection, code: number, reason: string) => void;
  isCurrentConnection: (
    connection: TConnection,
    profileId: CloudConnectorProfile["id"]
  ) => boolean;
  shutdownGraceMs?: number;
};

export type RequestContext<TConnection extends object> = {
  connection: TConnection;
  profile: CloudConnectorProfile;
  negotiated: boolean;
  filesNegotiated?: boolean;
  previewNegotiated?: boolean;
};
