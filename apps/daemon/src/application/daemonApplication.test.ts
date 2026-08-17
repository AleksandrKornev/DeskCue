import assert from "node:assert/strict";
import test from "node:test";

import { closeDaemonApplicationResources } from "./daemonApplication.ts";

test("application resource rollback closes every partially created owner", async () => {
  const closed = new Set<string>();

  await closeDaemonApplicationResources({
    agentSessionReviews: {
      close: () => closed.add("reviews")
    } as never,
    discovery: {
      close: async () => {
        closed.add("discovery");
      }
    } as never,
    localLlmChats: {
      close: async () => {
        closed.add("local-llm");
      }
    } as never,
    lmStudioRuntime: {
      close: async () => {
        closed.add("lm-studio-runtime");
      }
    } as never,
    manualCommands: {
      close: async () => {
        closed.add("manual-commands");
      }
    } as never,
    sourceAgentSessions: {
      close: async () => {
        closed.add("source-agent-sessions");
      }
    } as never,
    storageMaintenance: {
      close: async () => {
        closed.add("maintenance");
      }
    },
    store: {
      close: async () => {
        closed.add("store");
      }
    } as never
  });

  assert.deepEqual([...closed].sort(), [
    "discovery",
    "lm-studio-runtime",
    "local-llm",
    "maintenance",
    "manual-commands",
    "reviews",
    "source-agent-sessions",
    "store"
  ]);
});

test("application resource rollback aggregates failures after closing all owners", async () => {
  let reviewsClosed = false;
  let storeClosed = false;

  await assert.rejects(
    closeDaemonApplicationResources({
      agentSessionReviews: {
        close() {
          reviewsClosed = true;
        }
      } as never,
      discovery: { close: async () => {} } as never,
      localLlmChats: {
        close: async () => {
          throw new Error("local close failed");
        }
      } as never,
      manualCommands: null,
      sourceAgentSessions: null,
      storageMaintenance: null,
      store: {
        close: async () => {
          storeClosed = true;
        }
      } as never
    }),
    AggregateError
  );

  assert.equal(reviewsClosed, true);
  assert.equal(storeClosed, true);
});

test("application resource rollback awaits manual command drain", async () => {
  let resolveManualCommands!: () => void;
  let closed = false;
  const manualCommandsClosed = new Promise<void>((resolve) => {
    resolveManualCommands = resolve;
  });

  const closePromise = closeDaemonApplicationResources({
    agentSessionReviews: null,
    discovery: { close: async () => {} } as never,
    localLlmChats: null,
    manualCommands: {
      close: async () => {
        await manualCommandsClosed;
        closed = true;
      }
    } as never,
    sourceAgentSessions: null,
    storageMaintenance: null,
    store: null
  });

  await Promise.resolve();
  assert.equal(closed, false);

  resolveManualCommands();
  await closePromise;
  assert.equal(closed, true);
});
