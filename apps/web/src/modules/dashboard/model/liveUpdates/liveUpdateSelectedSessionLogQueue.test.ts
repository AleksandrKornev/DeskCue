import assert from "node:assert/strict";
import test from "node:test";

import type { SessionLogLine } from "@deskcue/protocol";
import type { DashboardStore } from "@modules/dashboard/model/store";

import { createSelectedSessionLogQueue } from "./liveUpdateSelectedSessionLogQueue";

function createLog(id: string): SessionLogLine {
  return {
    id,
    stream: "stdout",
    text: id,
    timestamp: "2026-08-06T10:00:00.000Z"
  };
}

test("flushes batched logs against the session captured at enqueue time", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis
  });

  const appended: Array<{ logs: SessionLogLine[]; sessionId: string }> = [];
  const queue = createSelectedSessionLogQueue({
    store: {
      appendSelectedSessionLogs(sessionId: string, logs: SessionLogLine[]) {
        appended.push({ logs, sessionId });
      }
    } as DashboardStore
  });
  const firstLog = createLog("log-a");
  const secondLog = createLog("log-b");

  queue.push("session-a", firstLog);
  queue.push("session-b", secondLog);
  queue.flush();

  assert.deepEqual(appended, [
    { logs: [firstLog], sessionId: "session-a" },
    { logs: [secondLog], sessionId: "session-b" }
  ]);
  queue.teardown();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: previousWindow
  });
});
