import { randomUUID } from "node:crypto";
import net from "node:net";
import type { Socket } from "node:net";

import { BoundedNdjsonDecoder, encodeHostControlRequestFrame } from "./framing.ts";
import { readHostControlToken, resolveHostControlEndpoint, resolveHostControlPaths } from "./paths.ts";
import type { HostControlPaths } from "./paths.ts";
import { HOST_CONTROL_PROTOCOL_VERSION, parseHostControlResponse } from "./protocol.ts";
import type { HostControlMethod, HostControlResponse } from "./protocol.ts";

type RequestHostControlOptions = {
  paths?: HostControlPaths;
  request: { method: HostControlMethod; params?: Record<string, unknown> };
  timeoutMs?: number;
};

export class HostControlTokenReadError extends Error {
  readonly code = "host_control_token_read_failed";

  constructor(readonly cause: unknown) {
    super("DeskCue Host control token could not be read.");
    this.name = "HostControlTokenReadError";
  }
}

export class HostControlConnectionClosedError extends Error {
  readonly code = "host_control_connection_closed";

  constructor() {
    super("DeskCue Host closed the control connection without a response.");
    this.name = "HostControlConnectionClosedError";
  }
}

function resolveDefaultRequestTimeout(method: HostControlMethod) {
  if (method === "update.apply") return 35 * 60_000;
  if (method === "update.check") return 70_000;
  if (method === "daemon.restart") return 45_000;
  if (method === "daemon.start") return 35_000;
  if (method === "daemon.stop") return 15_000;

  return 3_000;
}

class HostControlRequestClient {
  private readonly decoder = new BoundedNdjsonDecoder();
  private rejectRequest: (error: unknown) => void = () => {};
  private readonly requestId = randomUUID();
  private resolveRequest: (response: HostControlResponse) => void = () => {};
  private settled = false;
  private socket: Socket | null = null;
  private timeout: NodeJS.Timeout | null = null;
  private token = "";

  constructor(private readonly options: Required<RequestHostControlOptions>) {}

  run() {
    let endpoint: string;

    try {
      this.token = readHostControlToken(this.options.paths.controlTokenFilePath);
      endpoint = resolveHostControlEndpoint(this.token, this.options.paths);
    } catch (error) {
      return Promise.reject(new HostControlTokenReadError(error));
    }

    return new Promise<HostControlResponse>((resolve, reject) => {
      this.resolveRequest = resolve;
      this.rejectRequest = reject;
      this.socket = net.createConnection(endpoint);
      this.socket.once("connect", this.handleConnect);
      this.socket.on("data", this.handleData);
      this.socket.once("error", this.handleError);
      this.socket.once("end", this.handleEnd);
      this.timeout = setTimeout(this.handleTimeout, this.options.timeoutMs);
      this.timeout.unref?.();
    });
  }

  private readonly finish = (action: () => void) => {
    if (this.settled) return;

    this.settled = true;
    if (this.timeout) clearTimeout(this.timeout);
    this.socket?.destroy();
    action();
  };

  private readonly handleConnect = () => {
    this.socket?.write(encodeHostControlRequestFrame({
      id: this.requestId,
      method: this.options.request.method,
      ...(this.options.request.params ? { params: this.options.request.params } : {}),
      protocolVersion: HOST_CONTROL_PROTOCOL_VERSION,
      token: this.token
    }));
  };

  private readonly handleData = (chunk: Buffer) => {
    try {
      const value = this.decoder.push(chunk);

      if (value) this.finish(() => this.resolveRequest(parseHostControlResponse(value, this.requestId)));
    } catch (error) {
      this.finish(() => this.rejectRequest(error));
    }
  };

  private readonly handleEnd = () => {
    if (this.settled) return;

    try {
      const value = this.decoder.finish();

      if (!value) throw new HostControlConnectionClosedError();

      this.finish(() => this.resolveRequest(parseHostControlResponse(value, this.requestId)));
    } catch (error) {
      this.finish(() => this.rejectRequest(error));
    }
  };

  private readonly handleError = (error: Error) => {
    this.finish(() => this.rejectRequest(error));
  };

  private readonly handleTimeout = () => {
    this.finish(() => this.rejectRequest(new Error("DeskCue host control request timed out.")));
  };

}

export function requestHostControl({
  paths = resolveHostControlPaths(),
  request,
  timeoutMs = resolveDefaultRequestTimeout(request.method)
}: RequestHostControlOptions): Promise<HostControlResponse> {
  return new HostControlRequestClient({ paths, request, timeoutMs }).run();
}
