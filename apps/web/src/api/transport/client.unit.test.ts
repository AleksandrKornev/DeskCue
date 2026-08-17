import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

import { api } from "./client";

describe("cloud machine HTTP client", () => {
  afterEach(() => {
    resetDeskCueRuntimeForTests();
    window.history.replaceState({}, "", "/");
  });

  it("maps the API path and adds the Cloud CSRF header to a mutation", async () => {
    window.history.replaceState({}, "", "/machines/machine-01/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));
    vi.spyOn(document, "cookie", "get")
      .mockReturnValue("__Host-deskcue_csrf=cloud-csrf-test");
    const captured: InternalAxiosRequestConfig[] = [];

    await api.post("/api/agents/sessions/source-1/reviewed", {}, {
      adapter: (config) => {
        captured.push(config);
        return Promise.resolve({
          config,
          data: {},
          headers: {},
          status: 200,
          statusText: "OK"
        } satisfies AxiosResponse);
      }
    });

    const request = captured[0];
    expect(request?.url)
      .toBe("/v1/machines/machine-01/deskcue/api/agents/sessions/source-1/reviewed");
    expect(request?.headers.get("X-CSRF-Token")).toBe("cloud-csrf-test");
    expect(request?.headers.get("Authorization")).toBeUndefined();
  });
});
