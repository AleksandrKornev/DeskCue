import assert from "node:assert/strict";
import test from "node:test";

import { createManagedShutdown } from "./managedShutdown.ts";

test("managed shutdown waits for late startup and closes before acknowledging", async () => {
  const events: string[] = [];
  let resolveController: ((controller: { close: () => Promise<void> }) => void) | undefined;
  const controllerReady = new Promise<{ close: () => Promise<void> }>((resolve) => {
    resolveController = resolve;
  });
  const shutdown = createManagedShutdown({
    awaitController: () => controllerReady,
    disconnect: () => {
      events.push("disconnect");
    },
    flush: async () => {
      events.push("flush");
    },
    reportFailure: () => {
      events.push("failure");
    },
    sendStopped: () => {
      events.push("stopped");
    },
    setExitCode: (exitCode) => {
      events.push(`exit-${exitCode}`);
    }
  });
  const stopping = shutdown("host-request");

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 0);

  resolveController?.({
    close: async () => {
      events.push("close");
    }
  });
  await stopping;

  assert.deepEqual(events, ["close", "stopped", "exit-0", "flush", "disconnect"]);
});

test("managed shutdown reports a close failure without a stopped acknowledgement", async () => {
  const events: string[] = [];
  const shutdown = createManagedShutdown({
    awaitController: async () => ({
      close: async () => {
        throw new Error("close failed");
      }
    }),
    disconnect: () => {
      events.push("disconnect");
    },
    flush: async () => {
      events.push("flush");
    },
    reportFailure: () => {
      events.push("failure");
    },
    sendStopped: () => {
      events.push("stopped");
    },
    setExitCode: (exitCode) => {
      events.push(`exit-${exitCode}`);
    }
  });

  await shutdown("host-request");

  assert.deepEqual(events, ["failure", "exit-1", "flush", "disconnect"]);
});
