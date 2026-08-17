import type { WebSocket } from "ws";

import { daemonConfig } from "#config/daemonConfig";

export class WebSocketHeartbeat {
  private readonly aliveSockets = new WeakSet<WebSocket>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly sockets: Set<WebSocket>) {
    this.timer = setInterval(() => {
      this.pingClients();
    }, daemonConfig.websocketHeartbeatIntervalMs);
    this.timer.unref();
  }

  add(socket: WebSocket) {
    this.markAlive(socket);
    socket.on("pong", () => {
      this.markAlive(socket);
    });
  }

  delete(socket: WebSocket) {
    this.aliveSockets.delete(socket);
  }

  close() {
    clearInterval(this.timer);
  }

  checkNow() {
    this.pingClients();
  }

  private markAlive(socket: WebSocket) {
    this.aliveSockets.add(socket);
  }

  private pingClients() {
    for (const socket of this.sockets) {
      if (!this.aliveSockets.has(socket)) {
        socket.terminate();
        continue;
      }

      this.aliveSockets.delete(socket);
      if (socket.readyState === socket.OPEN) {
        socket.ping();
      }
    }
  }
}
