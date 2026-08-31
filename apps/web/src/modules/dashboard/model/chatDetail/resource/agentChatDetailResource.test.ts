import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AgentSessionDetail,
  AgentTranscriptEntry
} from "@deskcue/protocol";
import { ApiHttpStatusError } from "@api/transport/errors";
import type { ConditionalJsonResult } from "@api/transport/requests";
import type { AgentChatDetailFetchResult } from "@modules/dashboard/model/chatDetail/requests/agentChatDetailRequests";
import {
  buildAgentChatDetailFetchOptions
} from "@modules/dashboard/model/chatDetail/requests/agentChatDetailRequests";

import {
  AgentChatDetailResource
} from "./agentChatDetailResource";
import type { AgentChatDetailResourceTransport } from "./agentChatDetailResource";

function createLoadOptions() {
  return {
    activeTab: "overview" as const,
    transcriptDetail: "summary" as const
  };
}

function createAgentSessionDetail(
  id: string,
  updatedAt: string,
  transcript: AgentTranscriptEntry[] = []
): AgentSessionDetail {
  return {
    agentId: "codex",
    agentLabel: "Codex",
    attachMode: "resume",
    cliVersion: null,
    filePath: "codex.jsonl",
    id,
    model: null,
    originator: null,
    reviewedAt: null,
    source: null,
    sourceSessionId: "source-1",
    title: "Agent chat",
    transcript,
    updatedAt,
    workspaceName: null,
    workspacePath: null,
    workState: "idle"
  };
}

function createTranscriptEntry(id: string): AgentTranscriptEntry {
  return {
    id,
    phase: null,
    role: "tool",
    text: id,
    timestamp: "2026-07-26T10:00:00.000Z"
  };
}

function createResult<TData>(data: TData): ConditionalJsonResult<TData> {
  return {
    data,
    etag: null,
    notModified: false,
    status: 200
  };
}

function createEntriesResult(entries: AgentTranscriptEntry[]) {
  return createResult({
    entries
  });
}

function createDetailResult(
  id: string,
  updatedAt: string,
  options: {
    etag?: string | null;
    notModified?: boolean;
    transcript?: AgentTranscriptEntry[];
  } = {}
) {
  return {
    detail: createAgentSessionDetail(id, updatedAt, options.transcript),
    etag: options.etag ?? null,
    notModified: options.notModified ?? false,
    status: options.notModified ? 304 : 200
  };
}

function createTransport(
  overrides: Partial<AgentChatDetailResourceTransport>
): AgentChatDetailResourceTransport {
  return {
    fetchDetail: () => Promise.resolve(
      createDetailResult("agent-1", "2026-07-26T10:00:00.000Z")
    ),
    hydrateChanges: () => Promise.resolve(createResult({
      files: [],
      groupId: "changes-1",
      sessionId: "agent-1"
    })),
    hydrateTranscriptEntries: (_agentSessionId, entryIds) =>
      Promise.resolve(createEntriesResult(entryIds.map(createTranscriptEntry))),
    ...overrides
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    reject,
    resolve
  };
}

function unwrapDeferred<T>(deferred: ReturnType<typeof createDeferred<T>>) {
  return deferred.promise;
}

async function waitForMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AgentChatDetailResource", () => {
  it("does not apply or cache a late response after an A-B-A resource clear", async () => {
    const pending: Array<{
      resolve: (value: AgentChatDetailFetchResult) => void;
    }> = [];
    let requestCount = 0;
    const resource = new AgentChatDetailResource({
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          return new Promise<AgentChatDetailFetchResult>((resolve) => {
            pending.push({ resolve });
          });
        }
      })
    });

    const oldRequest = resource.loadDetail("agent-1", createLoadOptions());

    await waitForMicrotasks();

    resource.clear();

    const currentRequest = resource.loadDetail("agent-1", createLoadOptions());

    await waitForMicrotasks();

    pending[1]?.resolve(createDetailResult("agent-1", "2026-07-26T10:02:00.000Z"));
    await currentRequest;

    pending[0]?.resolve(createDetailResult("agent-1", "2026-07-26T10:01:00.000Z"));
    await oldRequest;

    assert.equal(resource.readSnapshot("agent-1").updatedAt, "2026-07-26T10:02:00.000Z");
    const cached = await resource.loadDetail("agent-1", createLoadOptions());

    assert.ok(cached);

    assert.equal(cached.updatedAt, "2026-07-26T10:02:00.000Z");
    assert.equal(requestCount, 2);
  });

  it("dedupes in-flight detail loads and reuses fresh cache", async () => {
    let requestCount = 0;
    const resource = new AgentChatDetailResource({
      now: () => 1_000,
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          return Promise.resolve(
            createDetailResult("agent-1", "2026-07-26T10:00:00.000Z", {
              etag: "\"agent-1:v1\""
            })
          );
        }
      })
    });

    const [firstDetail, secondDetail] = await Promise.all([
      resource.loadDetail("agent-1", createLoadOptions()),
      resource.loadDetail("agent-1", createLoadOptions())
    ]);
    const cachedDetail = await resource.loadDetail("agent-1", createLoadOptions());

    assert.equal(requestCount, 1);
    assert.equal(firstDetail?.id, "agent-1");
    assert.equal(secondDetail?.id, "agent-1");
    assert.equal(cachedDetail?.id, "agent-1");
    assert.equal(resource.readSnapshot("agent-1").etag, "\"agent-1:v1\"");
  });

  it("does not reuse an in-flight request after its caller aborts", async () => {
    let requestCount = 0;
    const resource = new AgentChatDetailResource({
      transport: createTransport({
        fetchDetail: (_agentSessionId, options) => {
          requestCount += 1;
          if (requestCount === 1) {
            return new Promise<AgentChatDetailFetchResult>((_resolve, reject) => {
              options.signal?.addEventListener("abort", () => {
                reject(new DOMException("Request aborted", "AbortError"));
              }, { once: true });
            });
          }

          return Promise.resolve(createDetailResult("agent-1", "2026-07-26T10:00:00.000Z"));
        }
      })
    });
    const abortController = new AbortController();
    const abortedRequest = resource.loadDetail("agent-1", {
      ...createLoadOptions(),
      retry: false,
      signal: abortController.signal
    });

    abortController.abort();
    const nextDetail = await resource.loadDetail("agent-1", createLoadOptions());

    await assert.rejects(abortedRequest, { name: "AbortError" });
    assert.equal(nextDetail?.id, "agent-1");
    assert.equal(requestCount, 2);
    assert.equal(resource.readSnapshot("agent-1").status, "synced");
  });

  it("records 304 validation without treating cached data as a new payload load", async () => {
    let now = 1_000;
    let requestCount = 0;
    const resource = new AgentChatDetailResource({
      cacheTtlMs: 0,
      now: () => now,
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          return Promise.resolve(
            createDetailResult("agent-1", "2026-07-26T10:00:00.000Z", {
              etag: "\"agent-1:v1\"",
              notModified: requestCount > 1
            })
          );
        }
      })
    });

    await resource.loadDetail("agent-1", createLoadOptions());
    const firstSnapshot = resource.readSnapshot("agent-1");

    now = 2_000;

    await resource.refreshNow("agent-1", createLoadOptions());
    const secondSnapshot = resource.readSnapshot("agent-1");

    assert.equal(requestCount, 2);
    assert.equal(firstSnapshot.lastLoadedAt, 1_000);
    assert.equal(secondSnapshot.lastLoadedAt, 1_000);
    assert.equal(secondSnapshot.lastValidatedAt, 2_000);
    assert.equal(secondSnapshot.etag, "\"agent-1:v1\"");
    assert.equal(secondSnapshot.status, "synced");
  });

  it("exposes a recent-validation guard for passive wake refreshes", async () => {
    let now = 1_000;
    const resource = new AgentChatDetailResource({
      now: () => now,
      transport: createTransport({
        fetchDetail: () => Promise.resolve(
          createDetailResult("agent-1", "2026-07-26T10:00:00.000Z")
        )
      })
    });

    assert.equal(resource.hasRecentlyValidatedDetail("agent-1", 15_000), false);

    await resource.loadDetail("agent-1", createLoadOptions());
    assert.equal(resource.hasRecentlyValidatedDetail("agent-1", 15_000), true);

    now = 15_999;
    assert.equal(resource.hasRecentlyValidatedDetail("agent-1", 15_000), true);

    now = 16_000;
    assert.equal(resource.hasRecentlyValidatedDetail("agent-1", 15_000), false);

    await resource.loadDetail("agent-1", {
      ...createLoadOptions(),
      force: true
    });
    assert.equal(
      resource.invalidate("agent-1", {
        minimumUpdatedAt: "2026-07-26T10:01:00.000Z"
      }),
      true
    );

    assert.equal(resource.hasRecentlyValidatedDetail("agent-1", 15_000), false);
  });

  it("reuses detail cache across tabs when request options are equivalent", async () => {
    let requestCount = 0;
    const resource = new AgentChatDetailResource({
      now: () => 1_000,
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          return Promise.resolve(createDetailResult("agent-1", "2026-07-26T10:00:00.000Z"));
        }
      })
    });

    await resource.loadDetail("agent-1", {
      activeTab: "activity",
      transcriptDetail: "full"
    });
    await resource.loadDetail("agent-1", {
      activeTab: "logs",
      transcriptDetail: "full"
    });

    assert.equal(requestCount, 1);
  });

  it("reuses summary transcript-view cache across chat and activity tabs", async () => {
    let requestCount = 0;
    const resource = new AgentChatDetailResource({
      now: () => 1_000,
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          return Promise.resolve(createDetailResult("agent-1", "2026-07-26T10:00:00.000Z"));
        }
      })
    });

    await resource.loadDetail("agent-1", {
      activeTab: "overview",
      transcriptDetail: "summary"
    });
    await resource.loadDetail("agent-1", {
      activeTab: "activity",
      transcriptDetail: "summary"
    });

    assert.equal(requestCount, 1);
  });

  it("marks cached detail stale when a newer live event arrives", async () => {
    let requestCount = 0;
    const resource = new AgentChatDetailResource({
      now: () => 1_000,
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          return Promise.resolve(requestCount === 1
            ? createDetailResult("agent-1", "2026-07-26T10:00:00.000Z")
            : createDetailResult("agent-1", "2026-07-26T10:01:00.000Z"));
        }
      })
    });

    await resource.loadDetail("agent-1", createLoadOptions());
    assert.equal(
      resource.invalidate("agent-1", {
        minimumUpdatedAt: "2026-07-26T10:01:00.000Z",
        reason: "live-event"
      }),
      true
    );

    assert.equal(resource.readSnapshot("agent-1").status, "stale");

    const refreshed = await resource.loadDetail("agent-1", {
      ...createLoadOptions(),
      minimumUpdatedAt: "2026-07-26T10:01:00.000Z"
    });

    assert.equal(requestCount, 2);
    assert.equal(refreshed?.updatedAt, "2026-07-26T10:01:00.000Z");
    assert.equal(resource.readSnapshot("agent-1").status, "synced");
  });

  it("publishes a stable live invalidation and refresh state sequence", async () => {
    let updatedAt = "2026-07-26T10:00:00.000Z";
    const resource = new AgentChatDetailResource({
      transport: createTransport({
        fetchDetail: (sessionId) => Promise.resolve(createDetailResult(sessionId, updatedAt))
      })
    });
    const observedStatuses: string[] = [];
    const unsubscribe = resource.subscribe("agent-1", () => {
      observedStatuses.push(resource.readSnapshot("agent-1").status);
    });

    await resource.loadDetail("agent-1", createLoadOptions());
    const eventUpdatedAt = "2026-07-26T10:00:01.000Z";

    resource.invalidate("agent-1", {
      minimumUpdatedAt: eventUpdatedAt,
      reason: "live-event"
    });
    updatedAt = eventUpdatedAt;
    await resource.refreshNow("agent-1", {
      ...createLoadOptions(),
      minimumUpdatedAt: eventUpdatedAt,
      reason: "live-event",
      retry: false
    });

    assert.deepEqual(observedStatuses, [
      "loading",
      "synced",
      "stale",
      "refreshing",
      "synced"
    ]);
    assert.equal(resource.readSnapshot("agent-1").updatedAt, eventUpdatedAt);
    assert.equal(resource.readSnapshot("agent-1").isStale, false);

    unsubscribe();
    resource.clear();
  });

  it("throttles repeated live validation loads across callers", async () => {
    let now = 1_000;
    let requestCount = 0;
    const resource = new AgentChatDetailResource({
      now: () => now,
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          return Promise.resolve(requestCount === 1
            ? createDetailResult("agent-1", "2026-07-26T10:01:00.000Z")
            : createDetailResult("agent-1", "2026-07-26T10:02:00.000Z"));
        }
      })
    });

    const firstDetail = await resource.loadDetail("agent-1", {
      ...createLoadOptions(),
      minNetworkIntervalMs: 15_000,
      minimumUpdatedAt: "2026-07-26T10:01:00.000Z",
      retry: false
    });

    now = 2_000;
    const throttledDetail = await resource.loadDetail("agent-1", {
      ...createLoadOptions(),
      minNetworkIntervalMs: 15_000,
      minimumUpdatedAt: "2026-07-26T10:02:00.000Z",
      retry: false
    });
    const throttledSnapshot = resource.readSnapshot("agent-1");

    now = 16_000;
    const refreshedDetail = await resource.loadDetail("agent-1", {
      ...createLoadOptions(),
      minNetworkIntervalMs: 15_000,
      minimumUpdatedAt: "2026-07-26T10:02:00.000Z",
      retry: false
    });

    assert.equal(firstDetail?.updatedAt, "2026-07-26T10:01:00.000Z");
    assert.equal(throttledDetail?.updatedAt, "2026-07-26T10:01:00.000Z");
    assert.equal(throttledSnapshot.status, "stale");
    assert.equal(throttledSnapshot.staleReason, "live-event");
    assert.equal(refreshedDetail?.updatedAt, "2026-07-26T10:02:00.000Z");
    assert.equal(requestCount, 2);
  });

  it("lets forced live validation bypass the network throttle", async () => {
    let now = 1_000;
    let requestCount = 0;
    const resource = new AgentChatDetailResource({
      now: () => now,
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          return Promise.resolve(requestCount === 1
            ? createDetailResult("agent-1", "2026-07-26T10:01:00.000Z")
            : createDetailResult("agent-1", "2026-07-26T10:02:00.000Z"));
        }
      })
    });

    await resource.loadDetail("agent-1", {
      ...createLoadOptions(),
      minNetworkIntervalMs: 15_000,
      minimumUpdatedAt: "2026-07-26T10:01:00.000Z",
      retry: false
    });
    now = 2_000;
    const forcedDetail = await resource.refreshNow("agent-1", {
      ...createLoadOptions(),
      minNetworkIntervalMs: 15_000,
      minimumUpdatedAt: "2026-07-26T10:02:00.000Z",
      retry: false
    });

    assert.equal(forcedDetail?.updatedAt, "2026-07-26T10:02:00.000Z");
    assert.equal(requestCount, 2);
  });

  it("does not apply stale detail responses from an older generation", async () => {
    const firstRequest = createDeferred<AgentChatDetailFetchResult>();
    const secondRequest = createDeferred<AgentChatDetailFetchResult>();
    let requestCount = 0;
    const resource = new AgentChatDetailResource({
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          return requestCount === 1
            ? unwrapDeferred(firstRequest)
            : unwrapDeferred(secondRequest);
        }
      })
    });

    const firstLoad = resource.loadDetail("agent-1", createLoadOptions());
    const secondLoad = resource.loadDetail("agent-1", {
      ...createLoadOptions(),
      bypassDedupe: true
    });

    secondRequest.resolve(createDetailResult("agent-1", "2026-07-26T10:02:00.000Z"));
    await secondLoad;
    firstRequest.resolve(createDetailResult("agent-1", "2026-07-26T10:00:00.000Z"));
    await firstLoad;

    assert.equal(resource.readSnapshot("agent-1").updatedAt, "2026-07-26T10:02:00.000Z");
  });

  it("dedupes forced refreshes while an equivalent request is in flight", async () => {
    const pendingRequest = createDeferred<AgentChatDetailFetchResult>();
    let requestCount = 0;
    const resource = new AgentChatDetailResource({
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          return unwrapDeferred(pendingRequest);
        }
      })
    });

    const firstLoad = resource.loadDetail("agent-1", createLoadOptions());
    const forcedLoad = resource.refreshNow("agent-1", createLoadOptions());

    pendingRequest.resolve(createDetailResult("agent-1", "2026-07-26T10:01:00.000Z"));
    const [firstDetail, forcedDetail] = await Promise.all([firstLoad, forcedLoad]);

    assert.equal(requestCount, 1);
    assert.equal(firstDetail, forcedDetail);
    assert.equal(resource.readSnapshot("agent-1").updatedAt, "2026-07-26T10:01:00.000Z");
  });

  it("spaces stale live validation retries by the network interval", async () => {
    const timers: Array<() => void> = [];
    let requestCount = 0;
    let now = 10_000;
    const resource = new AgentChatDetailResource({
      clearTimeout: () => undefined,
      now: () => now,
      random: () => 0,
      retryBaseDelayMs: 250,
      setTimeout: (callback) => {
        timers.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          return Promise.resolve(requestCount === 1
            ? createDetailResult("agent-1", "2026-07-26T10:01:00.000Z", {
              notModified: true
            })
            : createDetailResult("agent-1", "2026-07-26T10:02:00.000Z"));
        }
      })
    });

    await resource.loadDetail("agent-1", {
      ...createLoadOptions(),
      minNetworkIntervalMs: 15_000,
      minimumUpdatedAt: "2026-07-26T10:02:00.000Z",
      retry: true
    });

    assert.equal(timers.length, 1);
    assert.equal(resource.readSnapshot("agent-1").retryAfterAt, 25_000);

    now = 25_000;
    timers[0]?.();
    await waitForMicrotasks();

    assert.equal(requestCount, 2);
    assert.equal(resource.readSnapshot("agent-1").status, "synced");
    assert.equal(resource.readSnapshot("agent-1").updatedAt, "2026-07-26T10:02:00.000Z");
  });

  it("schedules retry with backoff for transient detail failures", async () => {
    const timers: Array<() => void> = [];
    let requestCount = 0;
    let now = 10_000;
    const resource = new AgentChatDetailResource({
      clearTimeout: () => undefined,
      now: () => now,
      random: () => 0,
      retryBaseDelayMs: 250,
      setTimeout: (callback) => {
        timers.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          if (requestCount === 1) {
            return Promise.reject(new Error("network down"));
          }

          return Promise.resolve(
            createDetailResult("agent-1", "2026-07-26T10:03:00.000Z")
          );
        }
      })
    });

    await assert.rejects(
      resource.refreshNow("agent-1", {
        ...createLoadOptions(),
        retry: true
      })
    );

    assert.equal(timers.length, 1);
    assert.equal(resource.readSnapshot("agent-1").retryAttempt, 1);
    assert.equal(resource.readSnapshot("agent-1").retryAfterAt, 10_250);

    now = 10_250;
    timers[0]?.();
    await waitForMicrotasks();

    assert.equal(requestCount, 2);
    assert.equal(resource.readSnapshot("agent-1").status, "synced");
    assert.equal(resource.readSnapshot("agent-1").retryAttempt, 0);
  });

  it("does not retry non-retryable HTTP detail failures", async () => {
    const timers: Array<() => void> = [];
    const resource = new AgentChatDetailResource({
      setTimeout: (callback) => {
        timers.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      transport: createTransport({
        fetchDetail: () => Promise.reject(new ApiHttpStatusError(404, "Agent chat not found"))
      })
    });

    await assert.rejects(
      resource.refreshNow("agent-1", {
        ...createLoadOptions(),
        retry: true
      })
    );

    assert.equal(timers.length, 0);
    assert.equal(resource.readSnapshot("agent-1").status, "error");
  });

  it("retains the last detail error while a recovery request is pending", async () => {
    const recoveryRequest = createDeferred<AgentChatDetailFetchResult>();
    let requestCount = 0;
    const resource = new AgentChatDetailResource({
      transport: createTransport({
        fetchDetail: () => {
          requestCount += 1;
          return requestCount === 1
            ? Promise.reject(new Error("daemon unavailable"))
            : recoveryRequest.promise;
        }
      })
    });

    await assert.rejects(
      resource.refreshNow("agent-1", {
        ...createLoadOptions(),
        retry: false
      })
    );

    const retry = resource.refreshNow("agent-1", {
      ...createLoadOptions(),
      retry: false
    });
    const pendingSnapshot = resource.readSnapshot("agent-1");

    assert.equal(pendingSnapshot.status, "loading");
    assert.equal(pendingSnapshot.error?.message, "daemon unavailable");

    recoveryRequest.resolve(createDetailResult("agent-1", "2026-07-26T10:03:00.000Z"));
    await retry;

    assert.equal(resource.readSnapshot("agent-1").status, "synced");
    assert.equal(resource.readSnapshot("agent-1").error, null);
  });

  it("limits hydration actions to the configured concurrency", async () => {
    const pendingRequests: Array<{
      activeCountAtStart: number;
      resolve: (value: ConditionalJsonResult<{ entries: AgentTranscriptEntry[] }>) => void;
    }> = [];
    let activeCount = 0;
    let maxActiveCount = 0;
    const resource = new AgentChatDetailResource({
      hydrationConcurrency: 2,
      transport: createTransport({
        hydrateTranscriptEntries: async (_agentSessionId, entryIds) => {
          activeCount += 1;
          maxActiveCount = Math.max(maxActiveCount, activeCount);

          const result = await new Promise<ConditionalJsonResult<{ entries: AgentTranscriptEntry[] }>>(
            (resolve) => {
              pendingRequests.push({
                activeCountAtStart: activeCount,
                resolve
              });
            }
          );

          activeCount -= 1;
          return {
            ...result,
            data: {
              entries: entryIds.map(createTranscriptEntry)
            }
          };
        }
      })
    });

    const loads = [
      resource.hydrateTranscriptEntries("agent-1", ["entry-1"]),
      resource.hydrateTranscriptEntries("agent-1", ["entry-2"]),
      resource.hydrateTranscriptEntries("agent-1", ["entry-3"]),
      resource.hydrateTranscriptEntries("agent-1", ["entry-4"])
    ];

    await waitForMicrotasks();

    assert.equal(pendingRequests.length, 2);
    assert.equal(maxActiveCount, 2);
    assert.deepEqual(
      pendingRequests.map((request) => request.activeCountAtStart),
      [1, 2]
    );

    pendingRequests.shift()?.resolve(createEntriesResult([]));
    await waitForMicrotasks();
    assert.equal(pendingRequests.length, 2);

    while (pendingRequests.length > 0) {
      pendingRequests.shift()?.resolve(createEntriesResult([]));
      await waitForMicrotasks();
    }

    const hydratedEntries = await Promise.all(loads);

    assert.equal(maxActiveCount, 2);

    assert.deepEqual(
      hydratedEntries.map((entries) => entries[0]?.id),
      ["entry-1", "entry-2", "entry-3", "entry-4"]
    );
  });

  it("stores transcript hydration failures and clears them after a successful retry", async () => {
    let shouldFail = true;
    const resource = new AgentChatDetailResource({
      transport: createTransport({
        hydrateTranscriptEntries: (_agentSessionId, entryIds) => {
          if (shouldFail) {
            return Promise.reject(new Error("host unavailable"));
          }

          return Promise.resolve(createEntriesResult(entryIds.map(createTranscriptEntry)));
        }
      })
    });

    await assert.rejects(resource.hydrateTranscriptEntries("agent-1", ["entry-1"]));
    assert.equal(resource.hasFailedTranscriptEntry("agent-1", "entry-1"), true);
    assert.deepEqual(resource.readHydratedTranscriptEntries("agent-1", ["entry-1"]), []);

    shouldFail = false;
    const entries = await resource.hydrateTranscriptEntries("agent-1", ["entry-1"]);

    assert.equal(resource.hasFailedTranscriptEntry("agent-1", "entry-1"), false);
    assert.deepEqual(entries.map((entry) => entry.id), ["entry-1"]);
    assert.equal(resource.readHydratedTranscriptEntry("agent-1", "entry-1")?.id, "entry-1");
  });

  it("keeps old exact transcript hydration misses across append-like detail changes", async () => {
    let etag = "\"agent-1:v1\"";
    let hydrationRequestCount = 0;
    let returnEntry = false;
    let updatedAt = "2026-07-26T10:00:00.000Z";
    const resource = new AgentChatDetailResource({
      transport: createTransport({
        fetchDetail: () => Promise.resolve(createDetailResult("agent-1", updatedAt, {
          etag,
          transcript: [
            createTranscriptEntry("entry-0"),
            createTranscriptEntry("entry-2")
          ]
        })),
        hydrateTranscriptEntries: (_agentSessionId, entryIds) => {
          hydrationRequestCount += 1;
          return Promise.resolve(
            createEntriesResult(returnEntry ? entryIds.map(createTranscriptEntry) : [])
          );
        }
      })
    });

    await resource.loadDetail("agent-1", createLoadOptions());
    const firstMiss = await resource.hydrateTranscriptEntries("agent-1", ["entry-1"]);
    const cachedMiss = await resource.hydrateTranscriptEntries("agent-1", ["entry-1"]);

    assert.deepEqual(firstMiss, []);
    assert.deepEqual(cachedMiss, []);
    assert.equal(hydrationRequestCount, 1);
    assert.equal(resource.hasFailedTranscriptEntry("agent-1", "entry-1"), true);

    etag = "\"agent-1:v2\"";
    updatedAt = "2026-07-26T10:00:01.000Z";
    returnEntry = true;
    await resource.refreshNow("agent-1", createLoadOptions());
    const entries = await resource.hydrateTranscriptEntries("agent-1", ["entry-1"]);

    assert.equal(hydrationRequestCount, 1);
    assert.deepEqual(entries, []);
    assert.equal(resource.hasFailedTranscriptEntry("agent-1", "entry-1"), true);
  });

  it("retries exact transcript hydration misses beyond the current visible line index", async () => {
    let etag = "\"agent-1:v1\"";
    let hydrationRequestCount = 0;
    let returnEntry = false;
    let updatedAt = "2026-07-26T10:00:00.000Z";
    const resource = new AgentChatDetailResource({
      transport: createTransport({
        fetchDetail: () => Promise.resolve(createDetailResult("agent-1", updatedAt, {
          etag,
          transcript: [
            createTranscriptEntry("entry-0"),
            createTranscriptEntry("entry-2")
          ]
        })),
        hydrateTranscriptEntries: (_agentSessionId, entryIds) => {
          hydrationRequestCount += 1;
          return Promise.resolve(
            createEntriesResult(returnEntry ? entryIds.map(createTranscriptEntry) : [])
          );
        }
      })
    });

    await resource.loadDetail("agent-1", createLoadOptions());
    const firstMiss = await resource.hydrateTranscriptEntries("agent-1", ["entry-99"]);
    const cachedMiss = await resource.hydrateTranscriptEntries("agent-1", ["entry-99"]);

    assert.deepEqual(firstMiss, []);
    assert.deepEqual(cachedMiss, []);
    assert.equal(hydrationRequestCount, 1);
    assert.equal(resource.hasFailedTranscriptEntry("agent-1", "entry-99"), true);

    etag = "\"agent-1:v2\"";
    updatedAt = "2026-07-26T10:00:01.000Z";
    returnEntry = true;
    await resource.refreshNow("agent-1", createLoadOptions());
    const entries = await resource.hydrateTranscriptEntries("agent-1", ["entry-99"]);

    assert.equal(hydrationRequestCount, 2);
    assert.deepEqual(entries.map((entry) => entry.id), ["entry-99"]);
    assert.equal(resource.hasFailedTranscriptEntry("agent-1", "entry-99"), false);
  });

  it("stores changes hydration failures and clears them after a successful retry", async () => {
    let shouldFail = true;
    const resource = new AgentChatDetailResource({
      transport: createTransport({
        hydrateChanges: () => {
          if (shouldFail) {
            return Promise.reject(new Error("host unavailable"));
          }

          return Promise.resolve(createResult({
            files: [],
            groupId: "changes-1",
            sessionId: "agent-1"
          }));
        }
      })
    });

    await assert.rejects(resource.hydrateChanges("agent-1", "changes-1"));
    assert.equal(resource.hasFailedChanges("agent-1", "changes-1"), true);
    assert.equal(resource.readHydratedChanges("agent-1", "changes-1"), null);

    shouldFail = false;
    const changes = await resource.hydrateChanges("agent-1", "changes-1");

    assert.equal(resource.hasFailedChanges("agent-1", "changes-1"), false);
    assert.equal(changes.groupId, "changes-1");
    assert.equal(resource.readHydratedChanges("agent-1", "changes-1")?.groupId, "changes-1");
  });

  it("rejects active and queued hydration when the resource is cleared", async () => {
    let requestCount = 0;
    let resolveFirst!: (value: ConditionalJsonResult<{ entries: AgentTranscriptEntry[] }>) => void;
    const resource = new AgentChatDetailResource({
      hydrationConcurrency: 1,
      transport: createTransport({
        hydrateTranscriptEntries: (_agentSessionId, entryIds) => {
          requestCount += 1;
          if (requestCount === 1) {
            return new Promise((resolve) => {
              resolveFirst = resolve;
            });
          }

          return Promise.resolve(createEntriesResult(entryIds.map(createTranscriptEntry)));
        }
      })
    });

    const active = resource.hydrateTranscriptEntries("agent-1", ["entry-1"]);
    const queued = resource.hydrateTranscriptEntries("agent-1", ["entry-2"]);

    await waitForMicrotasks();

    assert.equal(requestCount, 1);

    resource.clear();
    await assert.rejects(active, { name: "AbortError" });
    await assert.rejects(queued, { name: "AbortError" });

    const afterClear = await resource.hydrateTranscriptEntries("agent-1", ["entry-3"]);

    assert.deepEqual(afterClear.map((entry) => entry.id), ["entry-3"]);

    assert.equal(requestCount, 2);

    resolveFirst(createEntriesResult([createTranscriptEntry("entry-1")]));
    await waitForMicrotasks();
    assert.equal(resource.readHydratedTranscriptEntry("agent-1", "entry-1"), null);
  });

  it("disposes an unsubscribed session after the idle TTL", async () => {
    const timers: Array<() => void> = [];
    const resource = new AgentChatDetailResource({
      stateIdleTtlMs: 60_000,
      setTimeout: (callback) => {
        timers.push(callback);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      transport: createTransport({})
    });
    const unsubscribe = resource.subscribe("agent-1", () => undefined);

    await resource.loadDetail("agent-1", createLoadOptions());

    unsubscribe();
    assert.equal(timers.length, 1);
    assert.equal(resource.readSnapshot("agent-1").status, "synced");

    timers[0]?.();
    assert.equal(resource.readSnapshot("agent-1").status, "idle");
    assert.equal(resource.readSnapshot("agent-1").detail, null);
  });

  it("bounds inactive session states with LRU eviction", async () => {
    const resource = new AgentChatDetailResource({
      stateLimit: 2,
      transport: createTransport({
        fetchDetail: (agentSessionId) => Promise.resolve(
          createDetailResult(agentSessionId, "2026-07-26T10:00:00.000Z")
        )
      })
    });

    await resource.loadDetail("agent-1", createLoadOptions());
    await resource.loadDetail("agent-2", createLoadOptions());
    await resource.loadDetail("agent-3", createLoadOptions());

    assert.equal(resource.readSnapshot("agent-1").status, "idle");
    assert.equal(resource.readSnapshot("agent-2").status, "synced");
    assert.equal(resource.readSnapshot("agent-3").status, "synced");
  });

  it("does not evict a newly subscribed state when the LRU limit is fully active", async () => {
    const resource = new AgentChatDetailResource({
      stateLimit: 1,
      transport: createTransport({
        fetchDetail: (sessionId) => Promise.resolve(
          createDetailResult(sessionId, "2026-07-26T10:00:00.000Z")
        )
      })
    });
    const unsubscribeFirst = resource.subscribe("agent-1", () => undefined);
    const unsubscribeSecond = resource.subscribe("agent-2", () => undefined);

    await resource.loadDetail("agent-1", createLoadOptions());
    await resource.loadDetail("agent-2", createLoadOptions());

    assert.equal(resource.readSnapshot("agent-1").status, "synced");
    assert.equal(resource.readSnapshot("agent-2").status, "synced");

    unsubscribeSecond();
    unsubscribeFirst();
    resource.clear();
  });

  it("bounds hydrated changes per session", async () => {
    const resource = new AgentChatDetailResource({
      transport: createTransport({
        hydrateChanges: (agentSessionId, groupId) => Promise.resolve(createResult({
          files: [],
          groupId,
          sessionId: agentSessionId
        }))
      })
    });

    for (let index = 0; index < 25; index += 1) {
      await resource.hydrateChanges("agent-1", `changes-${index}`);
    }

    assert.equal(resource.readHydratedChanges("agent-1", "changes-0"), null);
    assert.equal(
      resource.readHydratedChanges("agent-1", "changes-24")?.groupId,
      "changes-24"
    );
  });

  it("bounds failed transcript and changes hydration markers", async () => {
    const resource = new AgentChatDetailResource({
      transport: createTransport({
        hydrateChanges: () => Promise.reject(new Error("changes unavailable")),
        hydrateTranscriptEntries: () => Promise.resolve(createEntriesResult([]))
      })
    });
    const entryIds = Array.from({ length: 401 }, (_, index) => `entry-${index}`);

    await resource.hydrateTranscriptEntries("agent-1", entryIds);
    for (let index = 0; index < 49; index += 1) {
      await assert.rejects(resource.hydrateChanges("agent-1", `changes-${index}`));
    }

    assert.equal(resource.hasFailedTranscriptEntry("agent-1", "entry-0"), false);
    assert.equal(resource.hasFailedTranscriptEntry("agent-1", "entry-400"), true);
    assert.equal(resource.hasFailedChanges("agent-1", "changes-0"), false);
    assert.equal(resource.hasFailedChanges("agent-1", "changes-48"), true);
  });
});

describe("agent chat detail request options", () => {
  it("uses summary transcript view for activity and diff tabs", () => {
    const options = buildAgentChatDetailFetchOptions({
      activeTab: "diff",
      transcriptDetail: "summary"
    });

    assert.equal(options.includeTranscriptView, true);
    assert.equal(options.omitTranscript, undefined);
  });

  it("keeps transcript view on chat overview summary surface", () => {
    const options = buildAgentChatDetailFetchOptions({
      activeTab: "overview",
      transcriptDetail: "summary"
    });

    assert.equal(options.includeTranscriptView, true);
    assert.equal(options.omitTranscript, undefined);
  });

  it("keeps summary logs metadata-only", () => {
    const options = buildAgentChatDetailFetchOptions({
      activeTab: "logs",
      transcriptDetail: "summary"
    });

    assert.equal(options.includeTranscriptView, false);
    assert.equal(options.omitTranscript, true);
  });
});
