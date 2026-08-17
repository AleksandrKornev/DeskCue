import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { SessionDetail } from "@deskcue/protocol";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import type { FetchSessionView } from "@api/endpoint/sessions/types";
import type { ConditionalJsonResult } from "@api/transport/requests";

import {
  clearManagedSessionDetailRequestCacheForTests,
  fetchManagedSessionDetail,
  fetchManagedSessionDetailWithMeta
} from "./managedSessionRequests";

const originalGetOneWithMeta = sessionsApi.getOneWithMeta;

function createSessionDetail(id: string): SessionDetail {
  return {
    id
  } as SessionDetail;
}

function createResult<TData>(data: TData): ConditionalJsonResult<TData> {
  return {
    data,
    etag: null,
    notModified: false,
    status: 200
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

describe("managed session detail requests", () => {
  afterEach(() => {
    sessionsApi.getOneWithMeta = originalGetOneWithMeta;
    clearManagedSessionDetailRequestCacheForTests();
  });

  it("dedupes in-flight loads and reuses a fresh chat detail cache", async () => {
    const calls: Array<{ sessionId: string; view: FetchSessionView | null }> = [];
    const deferredSession = createDeferred<SessionDetail | null>();

    sessionsApi.getOneWithMeta = (sessionId, options) => {
      calls.push({
        sessionId,
        view: options?.view ?? null
      });

      return deferredSession.promise.then((session) => createResult(session));
    };

    const firstLoad = fetchManagedSessionDetail("session-1", { sessionView: "chat" });
    const secondLoad = fetchManagedSessionDetail("session-1", { sessionView: "chat" });

    assert.equal(calls.length, 1);
    deferredSession.resolve(createSessionDetail("session-1"));

    const [firstSession, secondSession] = await Promise.all([firstLoad, secondLoad]);
    const cachedSession = await fetchManagedSessionDetail("session-1", { sessionView: "chat" });

    assert.equal(calls.length, 1);
    assert.equal(firstSession?.id, "session-1");
    assert.equal(secondSession?.id, "session-1");
    assert.equal(cachedSession?.id, "session-1");
  });

  it("keeps detail views and debug log tails in separate cache buckets", async () => {
    const requestedOptions: Array<{
      debugLogTail: number | null;
      view: FetchSessionView | null;
    }> = [];
    sessionsApi.getOneWithMeta = (sessionId, options) => {
      requestedOptions.push({
        debugLogTail: options?.debugLogTail ?? null,
        view: options?.view ?? null
      });
      return Promise.resolve(createResult(createSessionDetail(sessionId)));
    };

    await Promise.all([
      fetchManagedSessionDetail("session-1"),
      fetchManagedSessionDetail("session-1", { sessionView: "chat" }),
      fetchManagedSessionDetail("session-1", {
        debugLogTail: 80,
        sessionView: "debug"
      }),
      fetchManagedSessionDetail("session-1", {
        debugLogTail: 40,
        sessionView: "debug"
      }),
      fetchManagedSessionDetail("session-1", { sessionView: "diff" })
    ]);

    assert.deepEqual(requestedOptions, [
      {
        debugLogTail: null,
        view: null
      },
      {
        debugLogTail: null,
        view: "chat"
      },
      {
        debugLogTail: 80,
        view: "debug"
      },
      {
        debugLogTail: 40,
        view: "debug"
      },
      {
        debugLogTail: null,
        view: "diff"
      }
    ]);
  });

  it("preserves a missing-session response for route recovery decisions", async () => {
    sessionsApi.getOneWithMeta = () => Promise.resolve({
      data: null,
      etag: null,
      notModified: false,
      status: 404
    });

    const result = await fetchManagedSessionDetailWithMeta("missing-session", {
      sessionView: "chat"
    });

    assert.equal(result.data, null);
    assert.equal(result.status, 404);
  });

  it("does not repopulate cache from an in-flight response after connection state is cleared", async () => {
    const firstRequest = createDeferred<ConditionalJsonResult<SessionDetail | null>>();
    let calls = 0;
    sessionsApi.getOneWithMeta = (sessionId) => {
      calls += 1;
      return calls === 1
        ? firstRequest.promise
        : Promise.resolve(createResult(createSessionDetail(sessionId)));
    };

    const staleLoad = fetchManagedSessionDetail("session-1", { sessionView: "chat" });
    clearManagedSessionDetailRequestCacheForTests();
    firstRequest.resolve(createResult(createSessionDetail("session-1")));
    await staleLoad;
    await fetchManagedSessionDetail("session-1", { sessionView: "chat" });

    assert.equal(calls, 2);
  });
});
