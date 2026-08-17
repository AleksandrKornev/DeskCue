import { parseCloudPreviewClientFrame } from "@deskcue/protocol/cloud";
import type {
  CloudPreviewClientFrame,
  CloudPreviewServerFrame
} from "@deskcue/protocol/cloud";

import {
  CloudPreviewHttpStreamCoordinator
} from "./cloudPreviewHttpStreamCoordinator.ts";
import type { CloudPreviewHttpResult } from "./cloudPreviewHttpStreamCoordinator.ts";
import { CloudPreviewRequestPolicy } from "./cloudPreviewRequestPolicy.ts";
import type { AuthorizedCloudPreviewRequest } from "./cloudPreviewRequestPolicy.ts";
import {
  CloudPreviewWebSocketStreamCoordinator
} from "./cloudPreviewWebSocketStreamCoordinator.ts";
import type {
  CloudPreviewWebSocketEvents,
  CloudPreviewWebSocketSession
} from "./cloudPreviewWebSocketStreamCoordinator.ts";

export type { CloudPreviewHttpResult } from "./cloudPreviewHttpStreamCoordinator.ts";
export type {
  CloudPreviewWebSocketEvents,
  CloudPreviewWebSocketSession
} from "./cloudPreviewWebSocketStreamCoordinator.ts";

export type CloudPreviewStreamBridgeOptions = {
  executeHttp(request: AuthorizedCloudPreviewRequest & {
    body: AsyncIterable<Buffer>;
    contentLength: number | null;
    signal: AbortSignal;
  }): Promise<CloudPreviewHttpResult>;
  openWebSocket?: (
    request: AuthorizedCloudPreviewRequest & { protocols: string[]; signal: AbortSignal },
    events: CloudPreviewWebSocketEvents
  ) => Promise<CloudPreviewWebSocketSession>;
  policy: CloudPreviewRequestPolicy;
  responseIdleTimeoutMs?: number;
  sendFrame(frame: CloudPreviewClientFrame): boolean;
};

export class CloudPreviewStreamBridge {
  private readonly http: CloudPreviewHttpStreamCoordinator;
  private readonly webSockets: CloudPreviewWebSocketStreamCoordinator;
  private epoch = 0;
  private closed = false;

  constructor(private readonly options: CloudPreviewStreamBridgeOptions) {
    const collaboratorOptions = {
      isActiveEpoch: (epoch: number) => this.isActiveEpoch(epoch),
      policy: options.policy,
      sendFrame: (frame: CloudPreviewClientFrame) => this.send(frame)
    };
    this.http = new CloudPreviewHttpStreamCoordinator({
      ...collaboratorOptions,
      executeHttp: options.executeHttp,
      responseIdleTimeoutMs: options.responseIdleTimeoutMs
    });
    this.webSockets = new CloudPreviewWebSocketStreamCoordinator({
      ...collaboratorOptions,
      openWebSocket: options.openWebSocket
    });
  }

  activateEpoch(epoch: number) {
    if (this.closed || !Number.isSafeInteger(epoch) || epoch <= this.epoch) return false;
    this.abortAll("machine_disconnected");
    this.epoch = epoch;
    return true;
  }

  async handleFrame(frame: CloudPreviewServerFrame, epoch: number): Promise<boolean> {
    if (!this.isActiveEpoch(epoch)) return false;
    if (frame.type === "preview.http.request.start") return this.http.start(frame, epoch);
    if (frame.type === "preview.http.request.chunk") return this.http.acceptChunk(frame);
    if (frame.type === "preview.http.request.end") return this.http.finish(frame);
    if (frame.type === "preview.http.request.cancel") return this.http.cancel(frame.streamId);
    if (frame.type === "preview.ws.open") return this.webSockets.open(frame, epoch);
    if (frame.type === "preview.ws.message.start") return this.webSockets.startMessage(frame);
    if (frame.type === "preview.ws.message.chunk") return this.webSockets.acceptChunk(frame);
    if (frame.type === "preview.ws.message.end") return this.webSockets.finishMessage(frame);
    if (frame.type === "preview.ws.close") {
      return this.webSockets.close(frame.streamId, frame.code, frame.reason, false);
    }
    if (frame.direction === "http.response") {
      return this.http.addResponseCredit(frame.streamId, frame.creditBytes);
    }
    return this.webSockets.addServerCredit(frame.streamId, frame.creditBytes);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.abortAll("machine_disconnected");
  }

  private isActiveEpoch(epoch: number) {
    return !this.closed && epoch === this.epoch;
  }

  private send(frame: CloudPreviewClientFrame) {
    if (this.closed) return false;
    try {
      parseCloudPreviewClientFrame(frame);
    } catch {
      return false;
    }
    return this.options.sendFrame(frame);
  }

  private abortAll(reason: string) {
    this.http.abortAll();
    this.webSockets.abortAll(reason);
  }
}
