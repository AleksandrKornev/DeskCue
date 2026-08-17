import { EventEmitter } from "node:events";

import type { ServerEvent } from "@deskcue/protocol";

import type { DaemonEventBus as DaemonEventBusPort } from "./ports.ts";

export class DaemonEventBus extends EventEmitter implements DaemonEventBusPort {
  publishServerEvent(event: ServerEvent): void {
    this.emit("event", event);
  }
}
