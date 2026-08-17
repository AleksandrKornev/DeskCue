import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { parseClientEvent } from "@deskcue/protocol";

import { readWebSocketMetricsSnapshot, resetWebSocketMetricsForTests } from "./live/metrics.ts";
import { SERVER_EVENT_REPLAY_BYTE_LIMIT, ServerEventReplayBuffer } from "./serverEventReplay.ts";

beforeEach(() => {
  resetWebSocketMetricsForTests();
});

test("server event replay buffers small events with cursors and skips log bodies", () => {
  const replay = new ServerEventReplayBuffer();
  const workspaceEvent = replay.assignCursor({
    type: "workspace.created",
    payload: {
      branch: null,
      createdAt: "2026-07-25T00:00:00.000Z",
      id: "workspace-replay-test",
      isGitRepo: false,
      name: "Replay workspace",
      path: "D:\\work\\replay"
    }
  });
  const logEvent = replay.assignCursor({
    type: "session.log",
    payload: {
      log: {
        id: "log-1",
        stream: "stdout",
        text: "private log line",
        timestamp: "2026-07-25T00:00:00.000Z"
      },
      sessionId: "session-1"
    }
  });

  const replayed = replay.readAfter(String(Number(workspaceEvent.cursor) - 1));

  assert.equal(Boolean(workspaceEvent.cursor), true);
  assert.equal(Boolean(logEvent.cursor), true);
  assert.equal(
    replayed.some((event) =>
      event.type === "workspace.created" && event.payload.id === "workspace-replay-test"
    ),
    true
  );
  assert.equal(
    replayed.some((event) => event.type === "session.log" && event.payload.log.id === "log-1"),
    false
  );
});

test("server event replay state is isolated per live server lifecycle", () => {
  const first = new ServerEventReplayBuffer();
  const event = first.assignCursor({
    type: "workspace.created",
    payload: {
      branch: null,
      createdAt: "2026-08-05T00:00:00.000Z",
      id: "old-workspace",
      isGitRepo: false,
      name: "Old workspace",
      path: "D:\\work\\old"
    }
  });
  const second = new ServerEventReplayBuffer();

  assert.equal(event.cursor, "1");
  assert.deepEqual(second.readAfter("0"), []);
  assert.equal(second.assignCursor({
    type: "workspace.created",
    payload: {
      branch: null,
      createdAt: "2026-08-05T00:00:00.000Z",
      id: "new-workspace",
      isGitRepo: false,
      name: "New workspace",
      path: "D:\\work\\new"
    }
  }).cursor, "1");
});

test("server event replay enforces per-event and aggregate byte budgets", () => {
  const replay = new ServerEventReplayBuffer();
  const cursors: string[] = [];

  for (let index = 0; index < 12; index += 1) {
    const event = replay.assignCursor({
      type: "local.llm.chat.approval.required",
      payload: {
        action: "run_workspace_command",
        chatId: `chat-${index}`,
        model: "model",
        requestedAt: "2026-08-06T00:00:00.000Z",
        runtimeId: "ollama",
        summary: "x".repeat(100 * 1024),
        title: "Large approval"
      }
    });
    cursors.push(event.cursor ?? "");
  }

  const replayed = replay.readAfter("0");
  const metrics = readWebSocketMetricsSnapshot();
  assert.equal(metrics.bufferedEventBytes <= SERVER_EVENT_REPLAY_BYTE_LIMIT, true);
  assert.equal(metrics.bufferedEventCount, replayed.length);
  assert.equal(metrics.droppedEventCount > 0, true);
  assert.equal(replayed.some((event) => event.cursor === cursors[0]), false);

  const oversized = replay.assignCursor({
    type: "local.llm.chat.approval.required",
    payload: {
      action: "run_workspace_command",
      chatId: "oversized-chat",
      model: "model",
      requestedAt: "2026-08-06T00:00:00.000Z",
      runtimeId: "ollama",
      summary: "x".repeat(140 * 1024),
      title: "Oversized approval"
    }
  });
  assert.equal(replay.readAfter("0").some((event) => event.cursor === oversized.cursor), false);
});

test("protocol client event parser accepts websocket cursor ack", () => {
  assert.deepEqual(
    parseClientEvent({
      clientId: "client-1",
      cursor: "42",
      type: "ack"
    }),
    {
      clientId: "client-1",
      cursor: "42",
      type: "ack"
    }
  );
});
