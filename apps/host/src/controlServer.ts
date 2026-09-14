import { timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import type { Server, Socket } from "node:net";

import {
  BoundedHostControlRequestDecoder,
  encodeHostControlFrame,
  HOST_CONTROL_PROTOCOL_VERSION,
  parseHostControlRequest
} from "@deskcue/host-control";
import type { HostControlRequest, HostControlResponse, HostStatus } from "@deskcue/host-control";

type HostControlHandler = (request: HostControlRequest) => Promise<HostStatus>;

const HOST_CONTROL_IDLE_TIMEOUT_MS = 5_000;
const HOST_CONTROL_MAX_CONNECTIONS = 32;

function tokensMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (actualBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function createFailureResponse(id: string, error: unknown): HostControlResponse {
  const hostError = error as {
    code?: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
  } | null;

  return {
    error: {
      code: hostError?.code ?? "host_control_failed",
      ...(hostError?.details ? { details: hostError.details } : {}),
      message: error instanceof Error ? error.message : String(error),
      retryable: hostError?.retryable === true
    },
    id,
    ok: false,
    protocolVersion: HOST_CONTROL_PROTOCOL_VERSION
  };
}

class HostControlConnection {
  private readonly decoder = new BoundedHostControlRequestDecoder();
  private handled = false;

  constructor(
    private readonly socket: Socket,
    private readonly token: string,
    private readonly handle: HostControlHandler
  ) {
    socket.setTimeout(HOST_CONTROL_IDLE_TIMEOUT_MS, () => socket.destroy());
    socket.on("data", this.handleData);
    socket.on("error", () => undefined);
    socket.once("end", this.handleEnd);
  }

  private readonly handleData = (chunk: Buffer) => {
    if (this.handled) return;

    try {
      const value = this.decoder.push(chunk);

      if (value !== null) this.processValue(value);
    } catch (error) {
      this.handled = true;
      this.respond(createFailureResponse("unknown", error));
    }
  };

  private readonly handleEnd = () => {
    if (this.handled) return;

    try {
      const value = this.decoder.finish();

      if (value !== null) this.processValue(value);
    } catch (error) {
      this.handled = true;
      this.respond(createFailureResponse("unknown", error));
    }
  };

  private processValue(value: unknown) {
    if (this.handled) return;

    this.handled = true;
    this.socket.setTimeout(0);
    let request: HostControlRequest;

    try {
      request = parseHostControlRequest(value);
      if (!tokensMatch(request.token, this.token)) {
        throw Object.assign(new Error("Host control authentication failed."), {
          code: "authentication_failed"
        });
      }
    } catch (error) {
      this.respond(createFailureResponse("unknown", error));
      return;
    }

    void this.handle(request)
      .then((status) => this.respond({
        id: request.id,
        ok: true,
        protocolVersion: HOST_CONTROL_PROTOCOL_VERSION,
        result: { status }
      }))
      .catch((error) => this.respond(createFailureResponse(request.id, error)));
  }

  private respond(response: HostControlResponse) {
    this.socket.end(encodeHostControlFrame(response));
  }
}

export class HostControlServer {
  private readonly server: Server;

  constructor(
    private readonly endpoint: string,
    handle: HostControlHandler,
    token: string
  ) {
    this.server = net.createServer((socket) => {
      new HostControlConnection(socket, token, handle);
    });
    this.server.maxConnections = HOST_CONTROL_MAX_CONNECTIONS;
  }

  close() {
    return new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }

  async listen() {
    const listening = once(this.server, "listening");

    this.server.listen(this.endpoint);
    await listening;
  }
}

export function createHostControlServer({
  endpoint,
  handle,
  token
}: {
  endpoint: string;
  handle: HostControlHandler;
  token: string;
}) {
  return new HostControlServer(endpoint, handle, token);
}
