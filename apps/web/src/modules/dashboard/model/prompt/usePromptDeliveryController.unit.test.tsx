import { act, render } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OverviewResponse, SessionDetail } from "@deskcue/protocol";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import type { PendingChatPrompt } from "@models/promptDelivery";
import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

import { usePromptDeliveryController } from "./usePromptDeliveryController";

const originalInterrupt = sessionsApi.interrupt;
const originalClaudeCapability = sessionsApi.getExternalClaudeBackgroundStopCapability;
const originalForceStopCapability = sessionsApi.getExternalForceStopCapability;

function TestHarness({
  handlersRef,
  loadSession,
  selectedSession,
  selectedSessionIdRef = { current: selectedSession.id },
  setError = vi.fn(),
  setIsInterruptingPrompt,
  setPendingChatPrompt = vi.fn(),
  setSelectedSession
}: {
  handlersRef: MutableRefObject<Controller | null>;
  loadSession: (sessionId: string) => Promise<SessionDetail>;
  selectedSession: SessionDetail;
  selectedSessionIdRef?: MutableRefObject<string>;
  setError?: (value: string) => void;
  setIsInterruptingPrompt: (value: boolean) => void;
  setPendingChatPrompt?: (value: PendingChatPrompt | null) => void;
  setSelectedSession: (session: SessionDetail | null) => void;
}) {
  handlersRef.current = usePromptDeliveryController({
    activeTakenOverAgentSession: null,
    loadOverview: () => Promise.resolve({} as OverviewResponse),
    loadSession,
    pendingChatPrompt: null,
    refreshActiveTakenOverAgentSession: () => Promise.resolve(),
    selectedSession,
    selectedSessionId: selectedSession.id,
    selectedSessionIdRef,
    selectedSessionRef: { current: selectedSession },
    promptOperationRef: { current: { epoch: 0, targetSessionId: "" } },
    setAwaitingChatReplySince: vi.fn(),
    setError,
    setIsInterruptingPrompt,
    setIsWaitingForChatReply: vi.fn(),
    setPendingChatPrompt,
    setSelectedSession
  });
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((nextResolve) => {
      resolve = nextResolve;
    }),
    resolve
  };
}

function createHandlersRef(): MutableRefObject<Controller | null> {
  return { current: null };
}

function createSession(patch: Partial<SessionDetail>): SessionDetail {
  return {
    id: "managed-claude-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "claude-code",
    sourceSessionId: "claude-source-1",
    command: "claude --resume claude-source-1",
    status: "running",
    startedAt: "2026-07-31T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-07-31T10:00:00.000Z",
    exitCode: null,
    preview: { active: false, artifacts: [], networkMode: "device-direct", port: null, targetUrl: null },
    replyState: { phase: "idle", promptText: null, requestedAt: null },
    git: { branch: null, changedFiles: [], diff: "", isDirty: false, isGitRepo: true, lastUpdatedAt: "2026-07-31T10:00:00.000Z" },
    logs: [],
    inputHistory: [],
    ...patch
  };
}

describe("usePromptDeliveryController", () => {
  afterEach(() => {
    sessionsApi.interrupt = originalInterrupt;
    sessionsApi.getExternalClaudeBackgroundStopCapability = originalClaudeCapability;
    sessionsApi.getExternalForceStopCapability = originalForceStopCapability;
    resetDeskCueRuntimeForTests();
    window.history.replaceState({}, "", "/");
  });

  it("clears the local interrupt state after a managed Claude stop without waiting for source refresh", async () => {
    const selectedSession = createSession({
      canSendInput: false,
      replyState: {
        phase: "waiting",
        promptText: "Long task",
        requestedAt: "2026-07-31T10:00:00.000Z"
      },
      status: "running"
    });
    const stoppedSession = createSession({
      canSendInput: true,
      exitCode: 1,
      finishedAt: "2026-07-31T10:00:05.000Z",
      inputBlockedReason: null,
      replyState: {
        phase: "idle",
        promptText: null,
        requestedAt: null
      },
      status: "stopped"
    });
    sessionsApi.getExternalClaudeBackgroundStopCapability = vi.fn(() => Promise.resolve(null));
    sessionsApi.getExternalForceStopCapability = vi.fn(() => Promise.resolve(null));
    sessionsApi.interrupt = vi.fn(() => Promise.resolve({ ok: true as const, data: stoppedSession }));

    const handlersRef = createHandlersRef();
    const setIsInterruptingPrompt = vi.fn();
    const setSelectedSession = vi.fn();
    const loadSession = vi.fn(() => Promise.resolve(stoppedSession));

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadSession={loadSession}
        selectedSession={selectedSession}
        setIsInterruptingPrompt={setIsInterruptingPrompt}
        setSelectedSession={setSelectedSession}
      />
    );

    await act(async () => {
      await handlersRef.current?.handleInterruptPrompt();
    });

    expect(setIsInterruptingPrompt).toHaveBeenNthCalledWith(1, true);
    expect(setIsInterruptingPrompt).toHaveBeenLastCalledWith(false);
    expect(setSelectedSession).toHaveBeenCalledWith(stoppedSession);
    expect(loadSession).toHaveBeenCalledWith("managed-claude-1", { sessionView: "chat" });
    expect(vi.mocked(sessionsApi.interrupt).mock.calls[0]?.[1])
      .toMatch(/^deskcue-[a-z0-9-]{8,}$/u);
    expect(sessionsApi.getExternalClaudeBackgroundStopCapability).not.toHaveBeenCalled();
    expect(sessionsApi.getExternalForceStopCapability).not.toHaveBeenCalled();
  });

  it("ignores a late interrupt response after the selected session changes", async () => {
    const selectedSession = createSession({});
    const stoppedSession = createSession({ status: "stopped" });
    const selectedSessionIdRef = { current: selectedSession.id };
    const interruptRequest = deferred<Awaited<ReturnType<typeof originalInterrupt>>>();
    sessionsApi.interrupt = vi.fn(() => interruptRequest.promise);
    const handlersRef = createHandlersRef();
    const setSelectedSession = vi.fn();
    const setPendingChatPrompt = vi.fn();

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadSession={() => Promise.resolve(stoppedSession)}
        selectedSession={selectedSession}
        selectedSessionIdRef={selectedSessionIdRef}
        setIsInterruptingPrompt={vi.fn()}
        setPendingChatPrompt={setPendingChatPrompt}
        setSelectedSession={setSelectedSession}
      />
    );

    const interruptPromise = handlersRef.current?.handleInterruptPrompt();
    selectedSessionIdRef.current = "managed-other";
    interruptRequest.resolve({ ok: true, data: stoppedSession });
    await act(async () => {
      await interruptPromise;
    });

    expect(setSelectedSession).not.toHaveBeenCalled();
    expect(setPendingChatPrompt).not.toHaveBeenCalled();
  });

  it("does not call host process fallbacks from a Cloud runtime", async () => {
    window.history.replaceState({}, "", "/machines/machine-1/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));
    sessionsApi.interrupt = vi.fn(() => Promise.resolve({
      ok: false as const,
      data: {
        kind: "external_desktop_fallback" as const,
        code: "external_desktop_interrupt_unavailable" as const,
        action: "open_on_host" as const,
        message: "fixture"
      }
    }));
    sessionsApi.getExternalClaudeBackgroundStopCapability = vi.fn(() => Promise.resolve(null));
    sessionsApi.getExternalForceStopCapability = vi.fn(() => Promise.resolve(null));
    const handlersRef = createHandlersRef();
    const setError = vi.fn();

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadSession={() => Promise.resolve(createSession({}))}
        selectedSession={createSession({ adapterId: "codex" })}
        setError={setError}
        setIsInterruptingPrompt={vi.fn()}
        setSelectedSession={vi.fn()}
      />
    );

    await act(async () => {
      await handlersRef.current?.handleInterruptPrompt();
    });

    expect(setError).toHaveBeenCalledWith(expect.stringContaining("connected computer"));
    expect(sessionsApi.getExternalClaudeBackgroundStopCapability).not.toHaveBeenCalled();
    expect(sessionsApi.getExternalForceStopCapability).not.toHaveBeenCalled();
  });

  it("hydrates a replay marker before committing an interrupt", async () => {
    const selectedSession = createSession({});
    const stoppedSession = createSession({ status: "stopped" });
    sessionsApi.interrupt = vi.fn(() => Promise.resolve({
      ok: true as const,
      data: { accepted: true as const, sessionId: selectedSession.id }
    }));
    const handlersRef = createHandlersRef();
    const loadSession = vi.fn(() => Promise.resolve(stoppedSession));
    const setSelectedSession = vi.fn();

    render(
      <TestHarness
        handlersRef={handlersRef}
        loadSession={loadSession}
        selectedSession={selectedSession}
        setIsInterruptingPrompt={vi.fn()}
        setSelectedSession={setSelectedSession}
      />
    );

    await act(async () => {
      await handlersRef.current?.handleInterruptPrompt();
    });

    expect(loadSession).toHaveBeenCalledWith(selectedSession.id, { sessionView: "chat" });
    expect(setSelectedSession).toHaveBeenCalledWith(stoppedSession);
  });
});

type Controller = ReturnType<typeof usePromptDeliveryController>;
