import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  DESKCUE_PROTOCOL_CAPABILITIES,
  DESKCUE_PROTOCOL_VERSION
} from "@deskcue/protocol";
import type { SecurityStatusResponse } from "@deskcue/protocol";
import { accessApi } from "@api/endpoint/access/endpoints";

import {
  clearSecurityStatusRequest,
  fetchSecurityStatus
} from "./securityStatusRequests";

const originalGetSecurityStatus = accessApi.getSecurityStatus;

function createSecurityStatus(authRequired: boolean) {
  return {
    authRequired,
    protocolCapabilities: [...DESKCUE_PROTOCOL_CAPABILITIES],
    protocolVersion: DESKCUE_PROTOCOL_VERSION
  } as SecurityStatusResponse;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

afterEach(() => {
  accessApi.getSecurityStatus = originalGetSecurityStatus;
  clearSecurityStatusRequest();
});

test("connection-state clear prevents reuse of an in-flight security status", async () => {
  const first = createDeferred<SecurityStatusResponse>();
  let calls = 0;
  const next = createSecurityStatus(false);
  accessApi.getSecurityStatus = () => {
    calls += 1;
    return calls === 1 ? first.promise : Promise.resolve(next);
  };

  const staleRequest = fetchSecurityStatus();
  clearSecurityStatusRequest();
  const currentRequest = fetchSecurityStatus();
  first.resolve(createSecurityStatus(true));

  assert.notEqual(staleRequest, currentRequest);
  assert.equal((await currentRequest).authRequired, false);
  assert.equal(calls, 2);
});
