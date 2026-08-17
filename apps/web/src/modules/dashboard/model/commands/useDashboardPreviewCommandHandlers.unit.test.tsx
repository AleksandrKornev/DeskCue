import { act, render } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  OverviewResponse,
  SessionDetail
} from "@deskcue/protocol";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
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
  selectedSessionIdRef = { current: "session-1" },
  selectionEpochRef = { current: 0 },
  selectedSession = createSession("session-1"),
  setSelectedSession
}: {
  handlersRef: MutableRefObject<Handlers | null>;
  loadOverview: () => Promise<OverviewResponse>;
  selectedSessionIdRef?: MutableRefObject<string>;
  selectionEpochRef?: MutableRefObject<number>;
  selectedSession?: SessionDetail;
  setSelectedSession: (session: SessionDetail | null) => void;
}) {
  handlersRef.current = useDashboardPreviewCommandHandlers({
    loadOverview,
    previewPort: "",
    selectedSessionId: "session-1",
    selectedSession,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef: selectionEpochRef,
    setError: vi.fn(),
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
    expect(loadOverview).toHaveBeenCalledTimes(1);
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
