import { act, fireEvent, render } from "@testing-library/react";
import type { MutableRefObject, SubmitEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  OverviewResponse,
  SessionDetail
} from "@deskcue/protocol";
import { emitConnectionConfigChangedEvent } from "@api/connection/events";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import type { ConditionalJsonResult } from "@api/transport/requests";
import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

import { useDashboardPreviewCommandHandlers } from "./useDashboardPreviewCommandHandlers";

const originalRefreshGitWithMeta = sessionsApi.refreshGitWithMeta;
const originalSetPreview = sessionsApi.setPreview;
const originalGetOne = sessionsApi.getOne;

type Handlers = ReturnType<typeof useDashboardPreviewCommandHandlers>;
type SetPreviewResult = Awaited<ReturnType<typeof sessionsApi.setPreview>>;

function submitWithReactEvent<Result>(
  action: (event: SubmitEvent<HTMLFormElement>) => Result
): Result {
  let result!: Result;
  let submitted = false;
  const view = render(
    <form
      aria-label="Test submit"
      onSubmit={(event) => {
        result = action(event);
        submitted = true;
      }}
    >
      <button type="submit">Submit</button>
    </form>
  );

  const form = view.getByRole("form", { name: "Test submit" });
  const submitter = view.getByRole("button", { name: "Submit" });

  fireEvent(form, new globalThis.SubmitEvent("submit", {
    bubbles: true,
    cancelable: true,
    submitter
  }));
  view.unmount();
  if (!submitted) throw new Error("Expected the React submit handler to run");

  return result;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

function createHandlersRef(): MutableRefObject<Handlers | null> {
  return {
    current: null
  };
}

function createSession(
  id: string,
  port: number | null = null,
  networkMode: "device-direct" | "deskcue-host" = "device-direct"
): SessionDetail {
  return {
    id,
    preview: {
      active: port !== null,
      artifacts: [],
      networkMode,
      port,
      targetUrl: port === null ? null : `http://127.0.0.1:${port}`
    }
  } as unknown as SessionDetail;
}

function createOverview(): OverviewResponse {
  return {} as OverviewResponse;
}

function createRefreshResult(
  data: SessionDetail,
  options: {
    notModified: boolean;
    status: number;
  }
): ConditionalJsonResult<SessionDetail> {
  return {
    data,
    etag: "\"session:v1\"",
    notModified: options.notModified,
    status: options.status
  };
}

function TestHarness({
  handlersRef,
  loadOverview,
  previewPort = "",
  selectedSessionIdRef = { current: "session-1" },
  selectionEpochRef = { current: 0 },
  selectedSession = createSession("session-1"),
  setError = vi.fn(),
  setPreviewPort = vi.fn(),
  setSelectedSession
}: {
  handlersRef: MutableRefObject<Handlers | null>;
  loadOverview: () => Promise<OverviewResponse>;
  previewPort?: string;
  selectedSessionIdRef?: MutableRefObject<string>;
  selectionEpochRef?: MutableRefObject<number>;
  selectedSession?: SessionDetail;
  setError?: (error: string) => void;
  setPreviewPort?: (value: string) => void;
  setSelectedSession: (session: SessionDetail | null) => void;
}) {
  handlersRef.current = useDashboardPreviewCommandHandlers({
    loadOverview,
    previewPort,
    selectedSessionId: "session-1",
    selectedSession,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef: selectionEpochRef,
    setError,
    setPreviewPort,
    setSelectedSession
  });
  return null;
}

describe("useDashboardPreviewCommandHandlers", () => {
  afterEach(() => {
    sessionsApi.refreshGitWithMeta = originalRefreshGitWithMeta;
    sessionsApi.setPreview = originalSetPreview;
    sessionsApi.getOne = originalGetOne;
    resetDeskCueRuntimeForTests();
    window.history.replaceState({}, "", "/");
  });

  it("skips overview reload when git refresh returns not modified", async () => {
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.refreshGitWithMeta = vi.fn(() =>
      Promise.resolve(createRefreshResult(createSession("session-1"), {
        notModified: true,
        status: 304
      }))
    );

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={loadOverview}
        setSelectedSession={setSelectedSession}
      />
    );

    await act(async () => {
      await handlersRef.current?.handleRefreshGit();
    });

    expect(setSelectedSession).toHaveBeenCalledWith(createSession("session-1"));
    expect(loadOverview).not.toHaveBeenCalled();
  });

  it("reloads overview when git refresh returns changed data", async () => {
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.refreshGitWithMeta = vi.fn(() =>
      Promise.resolve(createRefreshResult(createSession("session-1"), {
        notModified: false,
        status: 200
      }))
    );

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={loadOverview}
        setSelectedSession={setSelectedSession}
      />
    );

    await act(async () => {
      await handlersRef.current?.handleRefreshGit();
    });

    expect(setSelectedSession).toHaveBeenCalledWith(createSession("session-1"));
    expect(loadOverview).toHaveBeenCalledTimes(1);
  });

  it("rejects a late response after an A to B to A selection cycle", async () => {
    const request = deferred<ConditionalJsonResult<SessionDetail>>();
    const selectedSessionIdRef = { current: "session-1" };
    const selectionEpochRef = { current: 0 };
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.refreshGitWithMeta = vi.fn(() => request.promise);

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={loadOverview}
        selectedSessionIdRef={selectedSessionIdRef}
        selectionEpochRef={selectionEpochRef}
        setSelectedSession={setSelectedSession}
      />
    );

    let refresh!: Promise<void>;

    act(() => {
      refresh = handlersRef.current?.handleRefreshGit() as Promise<void>;
      selectedSessionIdRef.current = "session-2";
      selectionEpochRef.current += 1;
      selectedSessionIdRef.current = "session-1";
      selectionEpochRef.current += 1;
    });
    await act(async () => {
      request.resolve(createRefreshResult(createSession("session-1"), {
        notModified: false,
        status: 200
      }));
      await refresh;
    });

    expect(setSelectedSession).not.toHaveBeenCalled();
    expect(loadOverview).not.toHaveBeenCalled();
  });

  it("rejects a late git response from a previous connection", async () => {
    const request = deferred<ConditionalJsonResult<SessionDetail>>();
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.refreshGitWithMeta = vi.fn(() => request.promise);

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={loadOverview}
        setSelectedSession={setSelectedSession}
      />
    );

    let refresh!: Promise<void>;

    act(() => {
      refresh = handlersRef.current?.handleRefreshGit() as Promise<void>;
      emitConnectionConfigChangedEvent();
    });
    await act(async () => {
      request.resolve(createRefreshResult(createSession("session-1"), {
        notModified: false,
        status: 200
      }));
      await refresh;
    });

    expect(setSelectedSession).not.toHaveBeenCalled();
    expect(loadOverview).not.toHaveBeenCalled();
  });

  it("saves host routing with the configured port through the preview update", async () => {
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn(() => Promise.resolve({
      data: createSession("session-1", 5173, "deskcue-host"),
      ok: true as const
    }));

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={loadOverview}
        selectedSession={createSession("session-1", 5173)}
        setSelectedSession={setSelectedSession}
      />
    );

    await act(async () => {
      await handlersRef.current?.handleChangePreviewNetworkMode("deskcue-host");
    });

    expect(sessionsApi.setPreview).toHaveBeenCalledWith("session-1", {
      networkMode: "deskcue-host",
      port: 5173
    }, expect.stringMatching(/^deskcue-[a-z0-9-]{8,}$/u));
    expect(setSelectedSession).toHaveBeenCalledWith(
      createSession("session-1", 5173, "deskcue-host")
    );

    expect(loadOverview).toHaveBeenCalledTimes(1);
  });

  it("stops preview by clearing its port while preserving the routing preference", async () => {
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const setError = vi.fn();
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn(() => Promise.resolve({
      data: createSession("session-1", null, "deskcue-host"),
      ok: true as const
    }));

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={loadOverview}
        selectedSession={createSession("session-1", 5173, "deskcue-host")}
        setError={setError}
        setSelectedSession={setSelectedSession}
      />
    );

    await act(async () => {
      await handlersRef.current?.handleStopPreview();
    });

    expect(sessionsApi.setPreview).toHaveBeenCalledWith("session-1", {
      networkMode: "deskcue-host",
      port: null
    }, expect.stringMatching(/^deskcue-[a-z0-9-]{8,}$/u));
    expect(setSelectedSession).toHaveBeenCalledWith(
      createSession("session-1", null, "deskcue-host")
    );

    expect(handlersRef.current?.previewError).toBe("");
    expect(setError).not.toHaveBeenCalled();
    expect(loadOverview).toHaveBeenCalledTimes(1);
  });

  it("does not clear unrelated errors or restore a stale preview failure after a port edit", async () => {
    const request = deferred<SetPreviewResult>();
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const setError = vi.fn();
    const setPreviewPort = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn(() => request.promise);

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={loadOverview}
        previewPort="5173"
        setError={setError}
        setPreviewPort={setPreviewPort}
        setSelectedSession={vi.fn()}
      />
    );

    const update = submitWithReactEvent(handlersRef.current!.handleSetPreview);

    act(() => {
      handlersRef.current?.handleChangePreviewPort("3000");
    });

    await act(async () => {
      request.reject(new Error("old preview request failed"));
      await update;
    });

    expect(setPreviewPort).toHaveBeenCalledWith("3000");
    expect(handlersRef.current?.previewError).toBe("");
    expect(setError).not.toHaveBeenCalled();
  });

  it("serializes overlapping preview mutations and commits only the latest intent", async () => {
    const stopRequest = deferred<SetPreviewResult>();
    const configureRequest = deferred<SetPreviewResult>();
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn<typeof sessionsApi.setPreview>((_sessionId, preview) =>
      preview.port === null ? stopRequest.promise : configureRequest.promise
    );

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={loadOverview}
        selectedSession={createSession("session-1", 5173, "device-direct")}
        setSelectedSession={setSelectedSession}
      />
    );

    let stop!: Promise<boolean>;
    let configure!: Promise<boolean>;

    await act(async () => {
      stop = handlersRef.current?.handleStopPreview() as Promise<boolean>;
      configure = handlersRef.current?.handleChangePreviewNetworkMode("deskcue-host") as Promise<boolean>;
      await Promise.resolve();
    });

    expect(sessionsApi.setPreview).toHaveBeenCalledTimes(1);
    expect(sessionsApi.setPreview).toHaveBeenLastCalledWith(
      "session-1",
      { networkMode: "device-direct", port: null },
      expect.any(String)
    );

    await act(async () => {
      stopRequest.resolve({
        data: createSession("session-1", null, "device-direct"),
        ok: true
      });
      await stop;
      await Promise.resolve();
    });

    expect(sessionsApi.setPreview).toHaveBeenCalledTimes(2);
    expect(sessionsApi.setPreview).toHaveBeenLastCalledWith(
      "session-1",
      { networkMode: "deskcue-host", port: 5173 },
      expect.any(String)
    );

    await act(async () => {
      configureRequest.resolve({
        data: createSession("session-1", 5173, "deskcue-host"),
        ok: true
      });
      await configure;
    });

    expect(setSelectedSession).toHaveBeenCalledOnce();
    expect(setSelectedSession).toHaveBeenCalledWith(
      createSession("session-1", 5173, "deskcue-host")
    );

    expect(loadOverview).toHaveBeenCalledOnce();
  });

  it("bounds overlapping preview mutations to the active and latest intent", async () => {
    const stopRequest = deferred<SetPreviewResult>();
    const latestRequest = deferred<SetPreviewResult>();
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn<typeof sessionsApi.setPreview>((_sessionId, preview) =>
      preview.port === null ? stopRequest.promise : latestRequest.promise
    );

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={loadOverview}
        selectedSession={createSession("session-1", 5173, "device-direct")}
        setSelectedSession={vi.fn()}
      />
    );

    let stop!: Promise<boolean>;
    let superseded!: Promise<boolean>;
    let latest!: Promise<boolean>;

    await act(async () => {
      stop = handlersRef.current?.handleStopPreview() as Promise<boolean>;
      superseded = handlersRef.current?.handleChangePreviewNetworkMode(
        "deskcue-host"
      ) as Promise<boolean>;
      latest = handlersRef.current?.handleChangePreviewNetworkMode(
        "device-direct"
      ) as Promise<boolean>;
      await Promise.resolve();
    });

    await expect(superseded).resolves.toBe(false);
    expect(sessionsApi.setPreview).toHaveBeenCalledTimes(1);

    await act(async () => {
      stopRequest.resolve({
        data: createSession("session-1", null, "device-direct"),
        ok: true
      });
      await stop;
      await Promise.resolve();
    });

    expect(sessionsApi.setPreview).toHaveBeenCalledTimes(2);
    expect(sessionsApi.setPreview).toHaveBeenLastCalledWith(
      "session-1",
      { networkMode: "device-direct", port: 5173 },
      expect.any(String)
    );

    await act(async () => {
      latestRequest.resolve({
        data: createSession("session-1", 5173, "device-direct"),
        ok: true
      });
      await latest;
    });

    expect(sessionsApi.setPreview).toHaveBeenCalledTimes(2);
    expect(loadOverview).toHaveBeenCalledOnce();
  });

  it("keeps the submitted port when a network-mode intent is queued during preview start", async () => {
    const startRequest = deferred<SetPreviewResult>();
    const modeRequest = deferred<SetPreviewResult>();
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn<typeof sessionsApi.setPreview>((_sessionId, preview) =>
      preview.networkMode === "device-direct" ? startRequest.promise : modeRequest.promise
    );

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={loadOverview}
        previewPort="5173"
        selectedSession={createSession("session-1")}
        setSelectedSession={vi.fn()}
      />
    );

    let changeMode!: Promise<boolean>;

    const start = submitWithReactEvent(handlersRef.current!.handleSetPreview);

    await act(async () => {
      changeMode = handlersRef.current?.handleChangePreviewNetworkMode(
        "deskcue-host"
      ) as Promise<boolean>;
      await Promise.resolve();
    });

    expect(sessionsApi.setPreview).toHaveBeenLastCalledWith(
      "session-1",
      { networkMode: "device-direct", port: 5173 },
      expect.any(String)
    );

    await act(async () => {
      startRequest.resolve({
        data: createSession("session-1", 5173),
        ok: true
      });
      await start;
      await Promise.resolve();
    });

    expect(sessionsApi.setPreview).toHaveBeenCalledTimes(2);
    expect(sessionsApi.setPreview).toHaveBeenLastCalledWith(
      "session-1",
      { networkMode: "deskcue-host", port: 5173 },
      expect.any(String)
    );

    await act(async () => {
      modeRequest.resolve({
        data: createSession("session-1", 5173, "deskcue-host"),
        ok: true
      });
      await changeMode;
    });
  });

  it("drops a queued preview mutation when its selection becomes stale before execution", async () => {
    const stopRequest = deferred<SetPreviewResult>();
    const selectedSessionIdRef = { current: "session-1" };
    const selectionEpochRef = { current: 0 };
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn<typeof sessionsApi.setPreview>(() => stopRequest.promise);

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={loadOverview}
        selectedSession={createSession("session-1", 5173, "device-direct")}
        selectedSessionIdRef={selectedSessionIdRef}
        selectionEpochRef={selectionEpochRef}
        setSelectedSession={setSelectedSession}
      />
    );

    let stop!: Promise<boolean>;
    let configure!: Promise<boolean>;

    await act(async () => {
      stop = handlersRef.current?.handleStopPreview() as Promise<boolean>;
      configure = handlersRef.current?.handleChangePreviewNetworkMode("deskcue-host") as Promise<boolean>;
      await Promise.resolve();
    });

    expect(sessionsApi.setPreview).toHaveBeenCalledTimes(1);

    selectedSessionIdRef.current = "session-2";
    selectionEpochRef.current += 1;

    await act(async () => {
      stopRequest.resolve({
        data: createSession("session-1", null, "device-direct"),
        ok: true
      });

      await Promise.all([stop, configure]);
    });

    expect(sessionsApi.setPreview).toHaveBeenCalledTimes(1);
    expect(setSelectedSession).not.toHaveBeenCalled();
    expect(loadOverview).not.toHaveBeenCalled();
  });

  it("drops a preview response from a previous connection", async () => {
    const request = deferred<SetPreviewResult>();
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn(() => request.promise);

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={loadOverview}
        selectedSession={createSession("session-1", 5173)}
        setSelectedSession={setSelectedSession}
      />
    );

    let update!: Promise<boolean>;

    act(() => {
      update = handlersRef.current?.handleStopPreview() as Promise<boolean>;
      emitConnectionConfigChangedEvent();
    });
    await act(async () => {
      request.resolve({
        data: createSession("session-1", null),
        ok: true
      });
      await update;
    });

    expect(setSelectedSession).not.toHaveBeenCalled();
    expect(loadOverview).not.toHaveBeenCalled();
  });

  it("hydrates a full session after an idempotent Cloud receipt replay", async () => {
    const session = createSession("session-1", 5173, "device-direct");
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn(() => Promise.resolve({
      data: { accepted: true, sessionId: "session-1" } as unknown as SessionDetail,
      ok: true as const
    }));
    sessionsApi.getOne = vi.fn(() => Promise.resolve(session));

    render(<TestHarness
      handlersRef={handlersRef}
      loadOverview={vi.fn(() => Promise.resolve(createOverview()))}
      selectedSession={createSession("session-1", 5173)}
      setSelectedSession={setSelectedSession}
    />);

    await act(async () => {
      await handlersRef.current?.handleChangePreviewNetworkMode("device-direct");
    });

    expect(sessionsApi.getOne).toHaveBeenCalledWith("session-1");
    expect(setSelectedSession).toHaveBeenCalledWith(session);
  });

  it("rejects delayed receipt recovery after an A to B to A selection cycle", async () => {
    const request = deferred<SessionDetail>();
    const selectedSessionIdRef = { current: "session-1" };
    const selectionEpochRef = { current: 0 };
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn(() => Promise.resolve({
      data: { accepted: true, sessionId: "session-1" } as unknown as SessionDetail,
      ok: true as const
    }));
    sessionsApi.getOne = vi.fn(() => request.promise);

    render(<TestHarness
      handlersRef={handlersRef}
      loadOverview={loadOverview}
      selectedSession={createSession("session-1", 5173)}
      selectedSessionIdRef={selectedSessionIdRef}
      selectionEpochRef={selectionEpochRef}
      setSelectedSession={setSelectedSession}
    />);

    let update!: Promise<boolean>;

    act(() => {
      update = handlersRef.current?.handleChangePreviewNetworkMode("device-direct") as Promise<boolean>;
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sessionsApi.getOne).toHaveBeenCalledWith("session-1");

    selectedSessionIdRef.current = "session-2";
    selectionEpochRef.current += 1;
    selectedSessionIdRef.current = "session-1";
    selectionEpochRef.current += 1;

    await act(async () => {
      request.resolve(createSession("session-1", 5173));
      await update;
    });

    expect(setSelectedSession).not.toHaveBeenCalled();
    expect(loadOverview).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous Cloud result before retaining it as a failure", async () => {
    const session = createSession("session-1", null, "device-direct");
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn(() => Promise.resolve({
      data: { error: "remote_control_outcome_unknown" },
      ok: false as const,
      status: 409
    }));
    sessionsApi.getOne = vi.fn(() => Promise.resolve(session));

    render(<TestHarness
      handlersRef={handlersRef}
      loadOverview={vi.fn(() => Promise.resolve(createOverview()))}
      selectedSession={createSession("session-1", 5173)}
      setSelectedSession={setSelectedSession}
    />);

    await act(async () => {
      await handlersRef.current?.handleStopPreview();
    });

    expect(sessionsApi.getOne).toHaveBeenCalledWith("session-1");
    expect(setSelectedSession).toHaveBeenCalledWith(session);
  });

  it("rejects delayed ambiguous recovery after an A to B to A selection cycle", async () => {
    const request = deferred<SessionDetail>();
    const selectedSessionIdRef = { current: "session-1" };
    const selectionEpochRef = { current: 0 };
    const loadOverview = vi.fn(() => Promise.resolve(createOverview()));
    const setSelectedSession = vi.fn();
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn(() => Promise.resolve({
      data: { error: "remote_control_outcome_unknown" },
      ok: false as const,
      status: 409
    }));
    sessionsApi.getOne = vi.fn(() => request.promise);

    render(<TestHarness
      handlersRef={handlersRef}
      loadOverview={loadOverview}
      selectedSession={createSession("session-1", 5173)}
      selectedSessionIdRef={selectedSessionIdRef}
      selectionEpochRef={selectionEpochRef}
      setSelectedSession={setSelectedSession}
    />);

    let update!: Promise<boolean>;

    act(() => {
      update = handlersRef.current?.handleStopPreview() as Promise<boolean>;
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sessionsApi.getOne).toHaveBeenCalledWith("session-1");

    selectedSessionIdRef.current = "session-2";
    selectionEpochRef.current += 1;
    selectedSessionIdRef.current = "session-1";
    selectionEpochRef.current += 1;

    await act(async () => {
      request.resolve(createSession("session-1"));
      await update;
    });

    expect(setSelectedSession).not.toHaveBeenCalled();
    expect(loadOverview).not.toHaveBeenCalled();
  });

  it("does not invoke unsupported Cloud git or preview mutations", async () => {
    window.history.replaceState({}, "", "/machines/machine-1/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));
    const handlersRef = createHandlersRef();

    sessionsApi.refreshGitWithMeta = vi.fn();

    sessionsApi.setPreview = vi.fn();

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={vi.fn(() => Promise.resolve(createOverview()))}
        selectedSession={createSession("session-1", 5173)}
        setSelectedSession={vi.fn()}
      />
    );

    await act(async () => {
      await handlersRef.current?.handleRefreshGit();
      await handlersRef.current?.handleChangePreviewNetworkMode("deskcue-host");
      await handlersRef.current?.handleStopPreview();
    });

    expect(sessionsApi.refreshGitWithMeta).not.toHaveBeenCalled();
    expect(sessionsApi.setPreview).not.toHaveBeenCalled();
  });

  it.each(["Infinity", "1.5", "0", "65536", "0x1435"])(
    "rejects invalid preview port %s before submit or network-mode mutation",
    async (previewPort) => {
      const handlersRef = createHandlersRef();

      sessionsApi.setPreview = vi.fn();

      render(
        <TestHarness
          handlersRef={handlersRef}
          loadOverview={vi.fn(() => Promise.resolve(createOverview()))}
          previewPort={previewPort}
          selectedSession={createSession("session-1", 5173)}
          setSelectedSession={vi.fn()}
        />
      );

      const submit = submitWithReactEvent(handlersRef.current!.handleSetPreview);

      await act(async () => {
        await submit;
        expect(await handlersRef.current?.handleChangePreviewNetworkMode("deskcue-host"))
          .toBe(false);
      });

      expect(handlersRef.current?.previewError).toBe("");
      expect(sessionsApi.setPreview).not.toHaveBeenCalled();
    }
  );

  it("preserves host routing when the Cloud host enables preview control", async () => {
    window.history.replaceState({}, "", "/machines/machine-1/deskcue/");
    const runtime = createCloudMachineDeskCueRuntime(window.location);

    initializeDeskCueRuntime({
      ...runtime,
      features: {
        ...runtime.features,
        preview: true,
        previewControl: true
      }
    });
    const handlersRef = createHandlersRef();

    sessionsApi.setPreview = vi.fn(() => Promise.resolve({
      data: createSession("session-1", 5173, "deskcue-host"),
      ok: true as const
    }));

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadOverview={vi.fn(() => Promise.resolve(createOverview()))}
        selectedSession={createSession("session-1", 5173)}
        setSelectedSession={vi.fn()}
      />
    );

    await act(async () => {
      await handlersRef.current?.handleChangePreviewNetworkMode("deskcue-host");
    });

    expect(sessionsApi.setPreview).toHaveBeenCalledWith("session-1", {
      networkMode: "deskcue-host",
      port: 5173
    }, expect.stringMatching(/^deskcue-[a-z0-9-]{8,}$/u));
  });
});
