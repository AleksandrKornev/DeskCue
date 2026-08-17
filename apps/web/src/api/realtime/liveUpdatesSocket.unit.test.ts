import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DESKCUE_PROTOCOL_CAPABILITIES,
  DESKCUE_PROTOCOL_VERSION
} from "@deskcue/protocol";
import type { ServerEvent } from "@deskcue/protocol";
import { CONNECTION_CONFIG_CHANGED_EVENT } from "@api/connection/events";
import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

const mocks = vi.hoisted((): {
  config: {
    accessToken: string | null;
    daemonUrl: string;
    deviceId: string | null;
  };
} => ({
  config: {
    accessToken: null,
    daemonUrl: "http://deskcue.test",
    deviceId: "device-1"
  }
}));

vi.mock("@api/connection/config", () => ({
  buildWebSocketUrl: (path: string) => `ws://deskcue.test${path}`,
  getConnectionConfig: () => mocks.config
}));

class FakeWebSocket {
  static readonly OPEN = 1;
  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(value: string) {
    this.sent.push(value);
  }
}

vi.stubGlobal("WebSocket", FakeWebSocket);

import {
  acknowledgeLiveUpdateCursor,
  handleLiveUpdatesClose,
  openLiveUpdatesSocket
} from "./liveUpdatesSocket";

function eventWithCursor(cursor: string) {
  return { cursor } as ServerEvent;
}

describe("live update resume cursor", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetDeskCueRuntimeForTests();
    window.history.replaceState({}, "", "/");
    mocks.config = {
      accessToken: null,
      daemonUrl: "http://deskcue.test",
      deviceId: "device-1"
    };
  });

  it("reuses a cursor only for the same daemon access identity", () => {
    const socket = openLiveUpdatesSocket();
    const socketUrl = new URL(socket.url);
    expect(socketUrl.searchParams.get("protocolVersion"))
      .toBe(String(DESKCUE_PROTOCOL_VERSION));
    expect(socketUrl.searchParams.getAll("protocolCapability"))
      .toEqual([...DESKCUE_PROTOCOL_CAPABILITIES]);
    acknowledgeLiveUpdateCursor(socket, eventWithCursor("cursor-1"));

    expect(new URL(openLiveUpdatesSocket().url).searchParams.get("afterCursor"))
      .toBe("cursor-1");

    mocks.config = {
      ...mocks.config,
      deviceId: "device-2"
    };
    window.dispatchEvent(new Event(CONNECTION_CONFIG_CHANGED_EVENT));

    expect(new URL(openLiveUpdatesSocket().url).searchParams.get("afterCursor"))
      .toBeNull();
  });

  it("ignores a late acknowledgement from a socket opened before reconnect", () => {
    const oldSocket = openLiveUpdatesSocket();

    window.dispatchEvent(new Event(CONNECTION_CONFIG_CHANGED_EVENT));
    acknowledgeLiveUpdateCursor(oldSocket, eventWithCursor("stale-cursor"));

    expect(new URL(openLiveUpdatesSocket().url).searchParams.get("afterCursor"))
      .toBeNull();
  });

  it("ignores an unauthorized close from a socket opened before a connection change", () => {
    const oldSocket = openLiveUpdatesSocket();
    const unauthorized = vi.fn();
    window.addEventListener("deskcue:api-unauthorized", unauthorized);

    window.dispatchEvent(new Event(CONNECTION_CONFIG_CHANGED_EVENT));

    expect(handleLiveUpdatesClose(oldSocket, { code: 4001 } as CloseEvent)).toBe(false);
    expect(unauthorized).not.toHaveBeenCalled();
    window.removeEventListener("deskcue:api-unauthorized", unauthorized);
  });

  it("does not expire Cloud account auth from a bridged daemon unauthorized close", () => {
    window.history.replaceState({}, "", "/machines/machine-1/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));
    const socket = openLiveUpdatesSocket();
    const unauthorized = vi.fn();
    window.addEventListener("deskcue:api-unauthorized", unauthorized);

    expect(handleLiveUpdatesClose(socket, { code: 4001 } as CloseEvent)).toBe(false);
    expect(unauthorized).not.toHaveBeenCalled();
    window.removeEventListener("deskcue:api-unauthorized", unauthorized);
  });

  it("keeps direct daemon unauthorized closes on the local auth path", () => {
    const socket = openLiveUpdatesSocket();
    const unauthorized = vi.fn();
    window.addEventListener("deskcue:api-unauthorized", unauthorized);

    expect(handleLiveUpdatesClose(socket, { code: 4001 } as CloseEvent)).toBe(true);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    window.removeEventListener("deskcue:api-unauthorized", unauthorized);
  });

  it("does not persist or resume a cursor for bearer query credentials", () => {
    mocks.config = {
      accessToken: "secret-token-a",
      daemonUrl: "http://deskcue.test",
      deviceId: null
    };
    const firstSocket = openLiveUpdatesSocket();
    const fakeFirstSocket = firstSocket as unknown as FakeWebSocket;
    acknowledgeLiveUpdateCursor(firstSocket, eventWithCursor("bearer-cursor"));

    expect(sessionStorage.getItem("deskcue.liveUpdatesCursor")).toBeNull();
    expect(new URL(openLiveUpdatesSocket().url).searchParams.get("afterCursor"))
      .toBeNull();
    expect(fakeFirstSocket.sent).toHaveLength(1);
    const acknowledgement = JSON.parse(fakeFirstSocket.sent[0] ?? "null") as {
      clientId: unknown;
      cursor: unknown;
      type: unknown;
    };
    expect(typeof acknowledgement.clientId).toBe("string");
    expect(acknowledgement).toMatchObject({
      cursor: "bearer-cursor",
      type: "ack"
    });
  });
});
