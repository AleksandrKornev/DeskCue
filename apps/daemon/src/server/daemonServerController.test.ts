import assert from "node:assert/strict";
import test from "node:test";

import { createRealtimeThenStartCloudIngress } from "./daemonServerController.ts";

test("cloud ingress starts only after HTTP is listening and realtime is created", () => {
  const calls: string[] = [];
  const realtime = createRealtimeThenStartCloudIngress({
    createRealtime: () => {
      calls.push("realtime.create");
      return { ready: true };
    },
    server: { listening: true },
    setRealtime: () => {
      calls.push("realtime.owned");
    },
    startCloudIngress: () => {
      calls.push("cloud.start");
    }
  });

  assert.deepEqual(realtime, { ready: true });
  assert.deepEqual(calls, ["realtime.create", "realtime.owned", "cloud.start"]);
});

test("cloud ingress cannot start before the HTTP listener is ready", () => {
  const calls: string[] = [];

  assert.throws(() => createRealtimeThenStartCloudIngress({
    createRealtime: () => {
      calls.push("realtime.create");
      return {};
    },
    server: { listening: false },
    setRealtime: () => {
      calls.push("realtime.owned");
    },
    startCloudIngress: () => {
      calls.push("cloud.start");
    }
  }), /requires a listening DeskCue HTTP server/);
  assert.deepEqual(calls, []);
});

test("realtime ownership is retained when Cloud ingress startup fails", () => {
  let ownedRealtime: { ready: boolean } | null = null;

  assert.throws(() => createRealtimeThenStartCloudIngress({
    createRealtime: () => ({ ready: true }),
    server: { listening: true },
    setRealtime: (realtime) => {
      ownedRealtime = realtime;
    },
    startCloudIngress: () => {
      throw new Error("Cloud start failed");
    }
  }), /Cloud start failed/);
  assert.deepEqual(ownedRealtime, { ready: true });
});
