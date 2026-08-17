import assert from "node:assert/strict";
import test from "node:test";

import type { ServerEvent } from "@deskcue/protocol";

import { DaemonEventBus } from "./daemonEventBus.ts";

test("publishes daemon server events through an explicit event bus", () => {
  const eventBus = new DaemonEventBus();
  const events: ServerEvent[] = [];

  eventBus.on("event", (event) => {
    events.push(event);
  });

  eventBus.publishServerEvent({
    type: "workspace.created",
    payload: {
      id: "workspace-1",
      name: "Workspace",
      path: "C:/workspace",
      isGitRepo: true,
      branch: "main",
      createdAt: "2026-06-22T10:00:00.000Z"
    }
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "workspace.created");
});
