import axios from "axios";
import type { AxiosRequestConfig, AxiosResponse } from "axios";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  API_UNAUTHORIZED_EVENT,
  CONNECTION_CONFIG_CHANGED_EVENT
} from "@api/connection/events";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import {
  getDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";
import type { DeskCueRuntime } from "@runtime";

import { api } from "./client";
import { ApiUnauthorizedError } from "./errors";
import {
  clearConditionalJsonCache,
  getConditionalJsonResult,
  getJson,
  postApi
} from "./requests";

const originalGet = api.get;
const originalPost = api.post;

function installWindow() {
  const browserWindow = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserWindow
  });
  return browserWindow;
}

function mockGet(
  implementation: (
    url: string,
    config?: AxiosRequestConfig
  ) => Promise<AxiosResponse<unknown>>
) {
  api.get = implementation as unknown as typeof api.get;
}

function response<TData>(
  data: TData,
  status: number,
  headers: Record<string, string> = {}
) {
  return {
    config: {},
    data,
    headers,
    status,
    statusText: String(status)
  } as AxiosResponse<TData>;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function readHeader(headers: unknown, name: string) {
  if (!headers || typeof headers !== "object") {
    return null;
  }
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === "string" ? value : null;
}

function testRuntime(scope: string): DeskCueRuntime {
  return {
    buildAppPath: (path) => path,
    buildHttpUrl: (path) => path,
    buildWebSocketUrl: (path) => path,
    features: {
      accessSettings: false,
      cloudConnection: false,
      daemonLogs: false,
      externalHostProcessControls: false,
      files: false,
      gitRefresh: false,
      localLlmChats: false,
      localRuntimes: false,
      manualRunner: false,
      notifications: false,
      preview: false,
      previewControl: false,
      realtime: true,
      sessionCommands: true,
      workspaceManagement: false
    },
    getAuthorizationToken: () => null,
    getCacheScope: () => null,
    getRealtimeScope: () => scope,
    mode: "cloud-machine",
    readAppPath: (pathname) => pathname,
    routerBasename: "/"
  };
}

afterEach(() => {
  api.get = originalGet;
  api.post = originalPost;
  clearConditionalJsonCache();
  resetDeskCueRuntimeForTests();
  Reflect.deleteProperty(globalThis, "window");
});

test("forwards one stable command id on a control mutation", async () => {
  let capturedConfig: AxiosRequestConfig | undefined;
  api.post = ((_url, _data, config) => {
    capturedConfig = config;
    return Promise.resolve(response({ accepted: true }, 200));
  }) as typeof api.post;

  const result = await postApi<{ accepted: boolean }>(
    "/api/sessions/session-1/input?compact=1",
    { input: "bounded fixture" },
    { commandId: "deskcue-command-1" }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(readHeader(capturedConfig?.headers, "X-DeskCue-Command-Id"), "deskcue-command-1");
});

test("managed stop uses the compact Cloud route and forwards its stable command id", async () => {
  let capturedUrl = "";
  let capturedConfig: AxiosRequestConfig | undefined;
  api.post = ((url, _data, config) => {
    capturedUrl = url;
    capturedConfig = config;
    return Promise.resolve(response({ id: "session-1", status: "stopped" }, 200));
  }) as typeof api.post;

  const result = await sessionsApi.stop("session-1", "deskcue-stop-command-1");

  assert.equal(result.ok, true);
  assert.equal(capturedUrl, "/api/sessions/session-1/stop?compact=1");
  assert.equal(
    readHeader(capturedConfig?.headers, "X-DeskCue-Command-Id"),
    "deskcue-stop-command-1"
  );
});

test("preserves HTTP status and distinguishes transport failures in API results", async () => {
  api.post = (() => Promise.reject(Object.assign(new Error("Rejected"), {
    isAxiosError: true,
    response: {
      data: { error: "terminal_fixture" },
      status: 422
    }
  })));
  const rejected = await postApi("/api/sessions/session-1/interrupt?compact=1");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 422);

  api.post = (() => Promise.reject(Object.assign(new Error("Offline"), {
    isAxiosError: true
  })));
  const offline = await postApi("/api/sessions/session-1/interrupt?compact=1");
  assert.equal(offline.ok, false);
  assert.equal(offline.status, null);
});

test("emits the unauthorized event and throws the public 401 error", async () => {
  const browserWindow = installWindow();
  let unauthorizedEvents = 0;
  browserWindow.addEventListener(API_UNAUTHORIZED_EVENT, () => {
    unauthorizedEvents += 1;
  });
  mockGet(() => {
    const error = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: {
        data: { error: "Pairing required" },
        status: 401
      }
    });
    return Promise.reject(error);
  });

  await assert.rejects(
    getJson("/api/overview", "Overview failed"),
    (error: unknown) => {
      assert(error instanceof ApiUnauthorizedError);
      assert.equal(error.message, "Pairing required");
      return true;
    }
  );
  assert.equal(unauthorizedEvents, 1);
});

test("does not emit unauthorized for a 401 from an older connection epoch", async () => {
  const browserWindow = installWindow();
  const request = createDeferred<AxiosResponse<unknown>>();
  let unauthorizedEvents = 0;
  browserWindow.addEventListener(API_UNAUTHORIZED_EVENT, () => {
    unauthorizedEvents += 1;
  });
  mockGet(() => request.promise);

  const loading = getJson("/api/overview", "Overview failed");
  browserWindow.dispatchEvent(new Event(CONNECTION_CONFIG_CHANGED_EVENT));
  request.reject(Object.assign(new Error("Unauthorized"), {
    isAxiosError: true,
    response: { data: { error: "Pairing required" }, status: 401 }
  }));

  await assert.rejects(loading, ApiUnauthorizedError);
  assert.equal(unauthorizedEvents, 0);
});

test("does not emit unauthorized for a 401 from a previous runtime", async () => {
  const browserWindow = installWindow();
  const request = createDeferred<AxiosResponse<unknown>>();
  let unauthorizedEvents = 0;
  browserWindow.addEventListener(API_UNAUTHORIZED_EVENT, () => {
    unauthorizedEvents += 1;
  });
  initializeDeskCueRuntime(testRuntime("machine-a"));
  mockGet(() => request.promise);

  const loading = getJson("/api/overview", "Overview failed");
  initializeDeskCueRuntime(testRuntime("machine-b"));
  request.reject(Object.assign(new Error("Unauthorized"), {
    isAxiosError: true,
    response: { data: { error: "Cloud session expired" }, status: 401 }
  }));

  await assert.rejects(loading, ApiUnauthorizedError);
  assert.equal(unauthorizedEvents, 0);
});

test("passes AbortSignal through and preserves the cancellation error", async () => {
  const controller = new AbortController();
  const canceled = new axios.CanceledError("request canceled");
  let receivedSignal: AxiosRequestConfig["signal"];
  mockGet((_url, config) => {
    receivedSignal = config?.signal;
    return Promise.reject(canceled);
  });
  controller.abort();

  await assert.rejects(
    getJson("/api/overview", "Overview failed", { signal: controller.signal }),
    (error: unknown) => error === canceled
  );
  assert.equal(receivedSignal, controller.signal);
});

test("sends the cached ETag and reuses data for a 304 response", async () => {
  const configs: Array<AxiosRequestConfig | undefined> = [];
  let requestCount = 0;
  mockGet((_url, config) => {
    configs.push(config);
    requestCount += 1;
    return Promise.resolve(requestCount === 1
      ? response({ revision: 1 }, 200, { etag: '"revision-1"' })
      : response(undefined, 304));
  });

  const initial = await getConditionalJsonResult<{ revision: number }>(
    "/api/overview",
    "Overview failed"
  );
  const validated = await getConditionalJsonResult<{ revision: number }>(
    "/api/overview",
    "Overview failed"
  );

  assert.deepEqual(initial, {
    data: { revision: 1 },
    etag: '"revision-1"',
    notModified: false,
    status: 200
  });
  assert.deepEqual(validated, {
    data: { revision: 1 },
    etag: '"revision-1"',
    notModified: true,
    status: 304
  });
  assert.equal(readHeader(configs[1]?.headers, "If-None-Match"), '"revision-1"');
});

test("does not share conditional responses across runtime instances", async () => {
  const configs: Array<AxiosRequestConfig | undefined> = [];
  let requestCount = 0;
  mockGet((_url, config) => {
    configs.push(config);
    requestCount += 1;
    return Promise.resolve(response(
      { machine: requestCount },
      200,
      { etag: `"machine-${requestCount}"` }
    ));
  });

  initializeDeskCueRuntime(testRuntime("machine-1"));
  const first = await getConditionalJsonResult<{ machine: number }>(
    "/api/overview",
    "Overview failed"
  );
  initializeDeskCueRuntime(testRuntime("machine-2"));
  const second = await getConditionalJsonResult<{ machine: number }>(
    "/api/overview",
    "Overview failed"
  );

  assert.equal(first.data.machine, 1);
  assert.equal(second.data.machine, 2);
  assert.equal(readHeader(configs[1]?.headers, "If-None-Match"), null);
});

test("evicts the least-recently-used conditional entry after 64 keys", async () => {
  const configs: Array<{ url: string; config?: AxiosRequestConfig }> = [];
  mockGet((url, config) => {
    configs.push({ url, config });
    return Promise.resolve(response(
      { url },
      200,
      { etag: `"${url}"` }
    ));
  });

  for (let index = 0; index < 64; index += 1) {
    await getConditionalJsonResult(`/api/cache/${index}`, "Cache request failed");
  }
  await getConditionalJsonResult("/api/cache/0", "Cache request failed");
  await getConditionalJsonResult("/api/cache/64", "Cache request failed");
  await getConditionalJsonResult("/api/cache/1", "Cache request failed");
  await getConditionalJsonResult("/api/cache/0", "Cache request failed");

  const evictedRequest = configs.at(-2);
  const retainedRequest = configs.at(-1);
  assert.equal(evictedRequest?.url, "/api/cache/1");
  assert.equal(readHeader(evictedRequest?.config?.headers, "If-None-Match"), null);
  assert.equal(retainedRequest?.url, "/api/cache/0");
  assert.equal(
    readHeader(retainedRequest?.config?.headers, "If-None-Match"),
    '"/api/cache/0"'
  );
});

test("retries without stale ETag when connection state changes during a request", async () => {
  const first = createDeferred<AxiosResponse<unknown>>();
  const configs: Array<AxiosRequestConfig | undefined> = [];
  let calls = 0;
  mockGet((_url, config) => {
    configs.push(config);
    calls += 1;
    return calls === 1
      ? first.promise
      : Promise.resolve(response({ revision: 2 }, 200, { etag: '"revision-2"' }));
  });

  const loading = getConditionalJsonResult<{ revision: number }>(
    "/api/overview",
    "Overview failed"
  );
  clearConditionalJsonCache();
  first.resolve(response({ revision: 1 }, 200, { etag: '"revision-1"' }));

  assert.equal((await loading).data.revision, 2);
  assert.equal(calls, 2);
  assert.equal(readHeader(configs[1]?.headers, "If-None-Match"), null);
});

test("scopes a fallback response to the runtime that actually issued it", async () => {
  const machineA = testRuntime("machine-a");
  const machineB = testRuntime("machine-b");
  const first = createDeferred<AxiosResponse<unknown>>();
  const configs: Array<AxiosRequestConfig | undefined> = [];
  let calls = 0;
  mockGet((_url, config) => {
    configs.push(config);
    calls += 1;
    if (calls === 1) return first.promise;
    const machine = getDeskCueRuntime().getRealtimeScope();
    return Promise.resolve(response(
      { machine },
      200,
      { etag: `"${machine}"` }
    ));
  });

  initializeDeskCueRuntime(machineA);
  const loadingA = getConditionalJsonResult<{ machine: string }>(
    "/api/overview",
    "Overview failed"
  );

  initializeDeskCueRuntime(machineB);
  clearConditionalJsonCache();
  first.resolve(response({ machine: "stale-machine-a" }, 200, { etag: '"stale-a"' }));
  assert.equal((await loadingA).data.machine, "machine-b");

  initializeDeskCueRuntime(machineA);
  const reloadedA = await getConditionalJsonResult<{ machine: string }>(
    "/api/overview",
    "Overview failed"
  );

  assert.equal(reloadedA.data.machine, "machine-a");
  assert.equal(readHeader(configs[2]?.headers, "If-None-Match"), null);
});

test("does not return an uncached response from a second stale connection generation", async () => {
  const first = createDeferred<AxiosResponse<unknown>>();
  const second = createDeferred<AxiosResponse<unknown>>();
  const secondStarted = createDeferred<void>();
  let calls = 0;
  mockGet(() => {
    calls += 1;
    if (calls === 1) {
      return first.promise;
    }
    if (calls === 2) {
      secondStarted.resolve();
      return second.promise;
    }
    return Promise.resolve(response({ revision: 3 }, 200, { etag: '"revision-3"' }));
  });

  const loading = getConditionalJsonResult<{ revision: number }>(
    "/api/overview",
    "Overview failed"
  );
  clearConditionalJsonCache();
  first.resolve(response({ revision: 1 }, 200));
  await secondStarted.promise;
  clearConditionalJsonCache();
  second.resolve(response({ revision: 2 }, 200));

  assert.equal((await loading).data.revision, 3);
  assert.equal(calls, 3);
});

test("does not return a stale fallback response after an unexpected uncached 304", async () => {
  const fallback = createDeferred<AxiosResponse<unknown>>();
  const fallbackStarted = createDeferred<void>();
  let calls = 0;
  mockGet(() => {
    calls += 1;
    if (calls === 1) {
      return Promise.resolve(response(undefined, 304));
    }
    if (calls === 2) {
      fallbackStarted.resolve();
      return fallback.promise;
    }
    return Promise.resolve(response({ revision: 3 }, 200, { etag: '"revision-3"' }));
  });

  const loading = getConditionalJsonResult<{ revision: number }>(
    "/api/overview",
    "Overview failed"
  );
  await fallbackStarted.promise;
  clearConditionalJsonCache();
  fallback.resolve(response({ revision: 2 }, 200));

  assert.equal((await loading).data.revision, 3);
  assert.equal(calls, 3);
});
