import { beforeEach, describe, expect, it } from "vitest";

import {
  invalidateConnectionConfigCache,
  saveConnectionConfig
} from "@api/connection/configStorage";
import { buildDashboardCacheKey } from "@modules/dashboard/model/cache/storage";

import {
  activateDeskCueRuntime,
  buildCloudLoginUrl,
  createCloudMachineDeskCueRuntime,
  createLocalDeskCueRuntime,
  releaseDeskCueRuntime,
  readCloudMutationCsrfToken,
  resetDeskCueRuntimeForTests
} from "./config";

describe("DeskCue runtime boundary", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
    invalidateConnectionConfigCache();
    resetDeskCueRuntimeForTests();
  });

  it("preserves the local daemon URL, credential, and cache scope", () => {
    saveConnectionConfig({
      accessToken: "local-test-credential",
      daemonUrl: "http://deskcue.test:4100",
      deviceId: "browser-1"
    });
    const runtime = createLocalDeskCueRuntime();

    expect(runtime.mode).toBe("local");
    expect(runtime.routerBasename).toBe("/");
    expect(runtime.buildAppPath("/sessions/session-1")).toBe("/sessions/session-1");
    expect(runtime.readAppPath("/sessions/session-1")).toBe("/sessions/session-1");
    expect(runtime.buildHttpUrl("/api/overview"))
      .toBe("http://deskcue.test:4100/api/overview");
    expect(runtime.getAuthorizationToken()).toBe("local-test-credential");
    expect(runtime.getCacheScope())
      .toBe("local:http://deskcue.test:4100:browser-1");
    expect(runtime.getRealtimeScope()).toBeNull();
    expect(runtime.features.externalHostProcessControls).toBe(true);
    expect(runtime.features.files).toBe(true);
    expect(runtime.features.gitRefresh).toBe(true);
    expect(runtime.features.preview).toBe(true);
    expect(runtime.features.previewControl).toBe(true);
  });

  it("maps a cloud machine route to scoped HTTP and WebSocket transports", () => {
    window.history.replaceState(
      {},
      "",
      "/machines/machine-01/deskcue/sessions/session-1?tab=activity"
    );
    const runtime = createCloudMachineDeskCueRuntime(window.location);

    expect(runtime.mode).toBe("cloud-machine");
    expect(runtime.routerBasename).toBe("/machines/machine-01/deskcue");
    expect(runtime.buildAppPath("/sessions/session-1"))
      .toBe("/machines/machine-01/deskcue/sessions/session-1");
    expect(runtime.readAppPath("/machines/machine-01/deskcue/sessions/session-1"))
      .toBe("/sessions/session-1");
    expect(runtime.buildHttpUrl("/api/overview?sessionLimit=120"))
      .toBe("/v1/machines/machine-01/deskcue/api/overview?sessionLimit=120");
    expect(runtime.buildWebSocketUrl("/ws?protocolVersion=1"))
      .toBe("ws://localhost:3000/v1/machines/machine-01/deskcue/ws?protocolVersion=1");
    expect(runtime.getAuthorizationToken()).toBeNull();
    expect(runtime.getCacheScope()).toBeNull();
    expect(runtime.features.manualRunner).toBe(false);
    expect(runtime.features.realtime).toBe(false);
    expect(runtime.features.sessionCommands).toBe(false);
    expect(runtime.features.externalHostProcessControls).toBe(false);
    expect(runtime.features.files).toBe(false);
    expect(runtime.features.gitRefresh).toBe(false);
    expect(runtime.features.preview).toBe(false);
    expect(runtime.features.previewControl).toBe(false);
  });

  it("rejects malformed machine routes and cross-origin resource URLs", () => {
    window.history.replaceState({}, "", "/machines/not%2Fscoped/deskcue/");
    expect(() => createCloudMachineDeskCueRuntime(window.location))
      .toThrow("machine identifier is invalid");

    window.history.replaceState({}, "", "/machines/machine-01/deskcue/");
    const runtime = createCloudMachineDeskCueRuntime(window.location);
    expect(() => runtime.buildHttpUrl("https://outside.example/api/overview"))
      .toThrow("out-of-scope resource URL");
    expect(() => runtime.buildHttpUrl("/auth/me"))
      .toThrow("unsupported API path");

    window.history.replaceState({}, "", "/machines/machine.with-dot/deskcue/");
    expect(() => createCloudMachineDeskCueRuntime(window.location))
      .toThrow("machine identifier is invalid");
  });

  it("prefers the exact production Cloud CSRF cookie for same-origin mutations", () => {
    const cookies = "decoy__Host-deskcue_csrf=wrong; deskcue_dev_csrf=dev-value; __Host-deskcue_csrf=prod%2Dvalue";

    expect(readCloudMutationCsrfToken(
      "POST",
      "/v1/machines/machine-01/deskcue/api/agents/sessions",
      window.location,
      cookies
    )).toBe("prod-value");
    expect(readCloudMutationCsrfToken(
      "GET",
      "/v1/machines/machine-01/deskcue/api/agents/sessions",
      window.location,
      cookies
    )).toBeNull();
  });

  it("uses only the exact development CSRF cookie as a fallback", () => {
    expect(readCloudMutationCsrfToken(
      "POST",
      "/v1/machines/machine-01/deskcue/api/sessions/session-1/input",
      window.location,
      "prefix_deskcue_dev_csrf=wrong; deskcue_dev_csrf=dev%2Dvalue"
    )).toBe("dev-value");

    expect(readCloudMutationCsrfToken(
      "POST",
      "/v1/machines/machine-01/deskcue/api/sessions/session-1/input",
      window.location,
      "prefix_deskcue_dev_csrf=wrong; decoy__Host-deskcue_csrf=wrong"
    )).toBeNull();

    expect(readCloudMutationCsrfToken(
      "POST",
      "https://outside.example/v1/machines/machine-01/deskcue/api/agents/sessions",
      window.location,
      "deskcue_dev_csrf=dev-value"
    )).toBeNull();
  });

  it("keeps cloud login return paths and cache keys scoped", () => {
    window.history.replaceState(
      {},
      "",
      "/machines/machine-01/deskcue/sessions/session-1?view=chat#latest"
    );

    expect(buildCloudLoginUrl(window.location)).toBe(
      "/login?from=%2Fmachines%2Fmachine-01%2Fdeskcue%2Fsessions%2Fsession-1%3Fview%3Dchat%23latest"
    );
    expect(buildDashboardCacheKey("cloud-machine:machine-01"))
      .not.toBe(buildDashboardCacheKey("cloud-machine:machine-02"));
  });

  it("fails closed when two runtime providers try to own imperative transports", () => {
    window.history.replaceState({}, "", "/machines/machine-01/deskcue/");
    const firstOwner = Symbol("first-runtime");
    const secondOwner = Symbol("second-runtime");
    const runtime = createCloudMachineDeskCueRuntime(window.location);

    activateDeskCueRuntime(firstOwner, runtime);
    expect(() => activateDeskCueRuntime(secondOwner, runtime))
      .toThrow("one mounted runtime provider");
    releaseDeskCueRuntime(firstOwner);
    expect(() => activateDeskCueRuntime(secondOwner, runtime)).not.toThrow();
    releaseDeskCueRuntime(secondOwner);
  });
});
