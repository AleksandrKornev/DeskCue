import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import type { ServerEvent } from "@deskcue/protocol";
import type { DaemonEventBus } from "#application/ports";
import type { CloudConnectorProfile } from "#persistence/cloud/cloudConnectorStore";

import { CloudProjectionCoordinator } from "./connector/cloudProjectionCoordinator.ts";
import type { CloudProjectionStore } from "./connector/cloudProjectionCoordinator.ts";

class TestEventBus extends EventEmitter implements DaemonEventBus {
  publishServerEvent(event: ServerEvent) {
    this.emit("event", event);
  }
}

function profile(): CloudConnectorProfile {
  return {
    id: "profile-1",
    cloudOrigin: "https://cloud.example.test",
    displayName: "Machine",
    enabled: true,
    state: "connected",
    machineId: "machine-1",
    protocolVersion: 1,
    lastConnectedAt: null,
    lastErrorCode: null,
    credentialRef: "credential-ref",
    remoteReadEnabled: true,
    remoteFilesEnabled: true,
    remoteControlEnabled: true,
    remotePreviewEnabled: true,
    sessionLabelDisclosureEnabled: false
  };
}

function createStore(overrides: Partial<CloudProjectionStore> = {}): CloudProjectionStore {
  return {
    readActiveProfile: overrides.readActiveProfile ?? (() => profile()),
    readIdentity: overrides.readIdentity ?? (() => ({
      installationId: "installation-1",
      publicKey: "public-key",
      credentialRef: "credential-ref"
    })),
    enqueueSummaries: overrides.enqueueSummaries ?? (() => 0),
    updateState: overrides.updateState ?? (() => undefined)
  };
}

function emptyProjections() {
  return {
    listLocalLlmChats: async () => [],
    listManagedSessions: () => [],
    listSourceSessions: async () => []
  };
}

test("projection coordinator drains on close and handles failure callbacks safely", async () => {
  let releaseProjection!: () => void;
  let closeSettled = false;
  let enqueues = 0;
  const coordinator = new CloudProjectionCoordinator({
    events: new TestEventBus(),
    store: createStore({
      enqueueSummaries: () => {
        enqueues += 1;
        return enqueues;
      }
    }),
    projections: {
      ...emptyProjections(),
      listSourceSessions: () => new Promise((resolve) => {
        releaseProjection = () => resolve([]);
      })
    },
    readConnectionEpoch: () => 1,
    onProjectionReady: () => undefined,
    onProjectionError: () => undefined
  });
  void coordinator.projectNow();
  const closing = coordinator.close().then(() => {
    closeSettled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closeSettled, false);
  releaseProjection();
  await closing;
  assert.equal(enqueues, 0);

  const updates: Array<{ state: string; errorCode: string | null | undefined }> = [];
  const errors: string[] = [];
  const failingCoordinator = new CloudProjectionCoordinator({
    events: new TestEventBus(),
    store: createStore({
      enqueueSummaries: () => {
        throw new Error("outbox capacity reached");
      },
      updateState: (_id, state, options) => {
        updates.push({ state, errorCode: options.errorCode });
      }
    }),
    projections: emptyProjections(),
    readConnectionEpoch: () => 1,
    onProjectionReady: () => undefined,
    onProjectionError: (errorCode) => {
      errors.push(errorCode);
      throw new Error("reporter unavailable");
    }
  });
  await failingCoordinator.projectNow();
  assert.deepEqual(errors, ["outbox_capacity_reached"]);
  assert.deepEqual(updates, [{ state: "degraded", errorCode: "outbox_capacity_reached" }]);
  await failingCoordinator.close();
});

test("projection coordinator isolates secondary recovery store failures", async () => {
  let updateAttempts = 0;
  const errors: string[] = [];
  const coordinator = new CloudProjectionCoordinator({
    events: new TestEventBus(),
    store: createStore({
      enqueueSummaries: () => {
        throw new Error("outbox capacity reached");
      },
      updateState: () => {
        updateAttempts += 1;
        throw new Error("state database unavailable");
      }
    }),
    projections: emptyProjections(),
    readConnectionEpoch: () => 1,
    onProjectionReady: () => undefined,
    onProjectionError: (errorCode) => {
      errors.push(errorCode);
      throw new Error("reporter unavailable");
    }
  });

  await assert.doesNotReject(coordinator.projectNow());
  assert.equal(updateAttempts, 1);
  assert.deepEqual(errors, ["outbox_capacity_reached"]);
  await coordinator.close();
});

test("projection coordinator isolates readActiveProfile failure during recovery", async () => {
  let profileReads = 0;
  let updateAttempts = 0;
  const errors: string[] = [];
  const coordinator = new CloudProjectionCoordinator({
    events: new TestEventBus(),
    store: createStore({
      readActiveProfile: () => {
        profileReads += 1;
        if (profileReads >= 3) throw new Error("profile database unavailable");
        return profile();
      },
      enqueueSummaries: () => {
        throw new Error("outbox write failed");
      },
      updateState: () => {
        updateAttempts += 1;
      }
    }),
    projections: emptyProjections(),
    readConnectionEpoch: () => 1,
    onProjectionReady: () => undefined,
    onProjectionError: (errorCode) => {
      errors.push(errorCode);
      throw new Error("reporter unavailable");
    }
  });

  await assert.doesNotReject(coordinator.projectNow());
  assert.equal(profileReads, 3);
  assert.equal(updateAttempts, 0);
  assert.deepEqual(errors, ["projection_failed"]);
  await coordinator.close();
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for projection coordinator state.");
}

test("projection coordinator subscribes once and debounces daemon events", async () => {
  const events = new TestEventBus();
  let enqueues = 0;
  let readyCallbacks = 0;
  const coordinator = new CloudProjectionCoordinator({
    events,
    store: createStore({
      enqueueSummaries: () => {
        enqueues += 1;
        return enqueues;
      }
    }),
    projections: emptyProjections(),
    readConnectionEpoch: () => 1,
    onProjectionReady: () => {
      readyCallbacks += 1;
    },
    onProjectionError: () => undefined,
    intervalMs: 60_000,
    eventDebounceMs: 5
  });

  coordinator.start();
  coordinator.start();
  events.emit("event", {});
  events.emit("event", {});
  await waitFor(() => enqueues === 1);

  assert.equal(events.listenerCount("event"), 1);
  assert.equal(readyCallbacks, 1);
  await coordinator.close();
  assert.equal(events.listenerCount("event"), 0);
});

test("projection coordinator reruns a single flight and rejects a stale epoch", async () => {
  let epoch = 1;
  let sourceCalls = 0;
  let enqueues = 0;
  let readyCallbacks = 0;
  const releases: Array<() => void> = [];
  const coordinator = new CloudProjectionCoordinator({
    events: new TestEventBus(),
    store: createStore({
      enqueueSummaries: () => {
        enqueues += 1;
        return enqueues;
      }
    }),
    projections: {
      ...emptyProjections(),
      listSourceSessions: () => {
        sourceCalls += 1;
        return new Promise((resolve) => releases.push(() => resolve([])));
      }
    },
    readConnectionEpoch: () => epoch,
    onProjectionReady: () => {
      readyCallbacks += 1;
    },
    onProjectionError: () => undefined
  });

  const first = coordinator.projectNow();
  const coalesced = coordinator.projectNow();
  assert.equal(first, coalesced);
  assert.equal(sourceCalls, 1);
  releases.shift()?.();
  await first;
  await waitFor(() => sourceCalls === 2);

  epoch = 2;
  releases.shift()?.();
  await waitFor(() => enqueues === 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(enqueues, 1);
  assert.equal(readyCallbacks, 1);
  await coordinator.close();
});

test("projection coordinator contains timer and event invocation failures", async () => {
  const events = new TestEventBus();
  const reportedErrors: string[] = [];
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  const coordinator = new CloudProjectionCoordinator({
    events,
    store: createStore({
      updateState: () => {
        throw new Error("state database unavailable");
      }
    }),
    projections: {
      ...emptyProjections(),
      listSourceSessions: async () => {
        throw new Error("projection source unavailable");
      }
    },
    readConnectionEpoch: () => 1,
    onProjectionReady: () => undefined,
    onProjectionError: (errorCode) => {
      reportedErrors.push(errorCode);
      throw new Error("reporter unavailable");
    },
    intervalMs: 5,
    eventDebounceMs: 0
  });

  try {
    coordinator.start();
    assert.doesNotThrow(() => events.emit("event", {}));
    await waitFor(() => reportedErrors.length >= 2);
    await coordinator.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandledRejections, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
    await coordinator.close();
  }
});
