import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OverviewResponse, SessionDetail } from "@deskcue/protocol";
import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

import type { UseDashboardPromptCommandHandlerArgs } from "./types";
import { useDashboardPromptCommandHandler } from "./useDashboardPromptCommandHandler";

const requestConfirmation = vi.hoisted(() => vi.fn());
vi.mock("@components/ModalDialog", () => ({ requestConfirmation }));
vi.mock("@modules/dashboard/model/timing", () => ({
  wait: () => Promise.resolve()
}));

const originalAttach = agentSessionsApi.attach;
const originalGetOne = agentSessionsApi.getOne;
const originalSendInput = sessionsApi.sendInput;

function createHarness(selectedSession: SessionDetail) {
  const selectedSessionIdRef = { current: selectedSession.id };
  const promptDelivery = {
    beginPromptDelivery: vi.fn(),
    clearPromptDeliveryState: vi.fn(),
    interruptPromptBeforeSendingReplacement: vi.fn(() => Promise.resolve(true)),
    markPromptAccepted: vi.fn(),
    setIsInterruptingPrompt: vi.fn()
  };
  const args = {
    loadAgentSessions: vi.fn(() => Promise.resolve([])),
    loadSession: vi.fn(() => Promise.resolve(selectedSession)),
    overview: { sessions: [] } as unknown as OverviewResponse,
    promptDelivery,
    promptOperationRef: { current: { epoch: 0, targetSessionId: "" } },
    selectedAgentSessionId: "codex:source-1",
    selectedSession,
    selectedSessionId: selectedSession.id,
    selectedSessionIdRef,
    selectedSessionRef: { current: selectedSession },
    setActiveTab: vi.fn(),
    setError: vi.fn(),
    setSelectedSession: vi.fn(),
    setSelectedSessionId: vi.fn(),
    setSelectedWorkspaceId: vi.fn()
  } satisfies UseDashboardPromptCommandHandlerArgs;

  return {
    args,
    // This production factory has a historical `use` prefix but does not call React hooks.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    handleSendInput: useDashboardPromptCommandHandler(args),
    promptDelivery,
    selectedSessionIdRef
  };
}

function createSession(patch: Partial<SessionDetail>): SessionDetail {
  return {
    adapterId: "codex",
    canSendInput: true,
    command: "codex resume source-1",
    exitCode: null,
    finishedAt: null,
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: "2026-08-06T10:00:00.000Z"
    },
    id: "session-a",
    inputBlockedReason: null,
    inputHistory: [],
    lastActivityAt: "2026-08-06T10:00:00.000Z",
    logs: [],
    preview: { active: false, artifacts: [], networkMode: "device-direct", port: null, targetUrl: null },
    replyState: { phase: "idle", promptText: null, requestedAt: null },
    sourceSessionId: "source-1",
    startedAt: "2026-08-06T10:00:00.000Z",
    status: "running",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    ...patch
  };
}

function createActionRequest(): NonNullable<SessionDetail["actionRequest"]> {
  return {
    kind: "approval",
    command: "dangerous-command",
    reason: "Needs approval",
    requestedAt: "2026-08-06T10:01:00.000Z"
  };
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

describe("useDashboardPromptCommandHandler", () => {
  beforeEach(() => {
    localStorage.clear();
    agentSessionsApi.getOne = vi.fn(() => Promise.resolve(null));
    resetDeskCueRuntimeForTests();
    window.history.replaceState({}, "", "/machines/machine-1/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));
  });

  afterEach(() => {
    agentSessionsApi.attach = originalAttach;
    agentSessionsApi.getOne = originalGetOne;
    sessionsApi.sendInput = originalSendInput;
    requestConfirmation.mockReset();
    resetDeskCueRuntimeForTests();
  });

  it("does not apply a late attach response to a different selected session", async () => {
    const request = deferred<Awaited<ReturnType<typeof originalAttach>>>();
    agentSessionsApi.attach = vi.fn(() => request.promise);
    const harness = createHarness(createSession({ canSendInput: false }));
    const pending = harness.handleSendInput("continue");

    harness.selectedSessionIdRef.current = "session-b";
    request.resolve({ ok: true, data: createSession({ id: "managed-new" }) });

    await expect(pending).resolves.toBe(false);
    expect(harness.args.setSelectedSession).not.toHaveBeenCalled();
    expect(harness.args.setSelectedSessionId).not.toHaveBeenCalled();
    expect(harness.promptDelivery.markPromptAccepted).not.toHaveBeenCalled();
  });

  it("does not apply a late send response to a different selected session", async () => {
    const request = deferred<Awaited<ReturnType<typeof originalSendInput>>>();
    sessionsApi.sendInput = vi.fn(() => request.promise);
    const harness = createHarness(createSession({ canSendInput: true }));
    const pending = harness.handleSendInput("continue");

    harness.selectedSessionIdRef.current = "session-b";
    request.resolve({ ok: true, data: createSession({}) });

    await expect(pending).resolves.toBe(false);
    expect(harness.args.setSelectedSession).not.toHaveBeenCalled();
    expect(harness.promptDelivery.markPromptAccepted).not.toHaveBeenCalled();
  });

  it("assigns one bounded command id to a managed input action", async () => {
    sessionsApi.sendInput = vi.fn(() => Promise.resolve({
      ok: true as const,
      data: createSession({})
    }));
    const harness = createHarness(createSession({ canSendInput: true }));

    await harness.handleSendInput("continue");

    expect(sessionsApi.sendInput).toHaveBeenCalledTimes(1);
    const options = vi.mocked(sessionsApi.sendInput).mock.calls[0]?.[2];
    expect(options?.commandId).toMatch(/^deskcue-[a-z0-9-]{8,}$/u);
  });

  it("uses the replacement flow when fresh source metadata reports an active turn", async () => {
    agentSessionsApi.getOne = vi.fn(() => Promise.resolve({
      turnState: { phase: "active" },
      workState: "running"
    } as never));
    sessionsApi.sendInput = vi.fn(() => Promise.resolve({
      ok: true as const,
      data: createSession({})
    }));
    const harness = createHarness(createSession({ canSendInput: true }));

    await expect(harness.handleSendInput("continue")).resolves.toBe("session-a");

    expect(agentSessionsApi.getOne).toHaveBeenCalledWith(
      "codex:source-1",
      { omitTranscript: true }
    );
    expect(harness.promptDelivery.interruptPromptBeforeSendingReplacement).toHaveBeenCalledTimes(1);
    expect(sessionsApi.sendInput).toHaveBeenCalledTimes(1);
  });

  it("assigns one bounded command id to a source attach action", async () => {
    agentSessionsApi.attach = vi.fn(() => Promise.resolve({
      ok: true as const,
      data: createSession({ id: "managed-new" })
    }));
    const harness = createHarness(createSession({ canSendInput: false }));

    await harness.handleSendInput("continue");

    expect(agentSessionsApi.attach).toHaveBeenCalledTimes(1);
    const commandId = vi.mocked(agentSessionsApi.attach).mock.calls[0]?.[2];
    expect(commandId).toMatch(/^deskcue-[a-z0-9-]{8,}$/u);
  });

  it("rotates an ambiguous managed command only after duplicate confirmation", async () => {
    requestConfirmation.mockResolvedValue(true);
    sessionsApi.sendInput = vi.fn()
      .mockResolvedValueOnce({
        ok: false as const,
        status: 409,
        data: { error: "remote_control_outcome_unknown" }
      })
      .mockResolvedValueOnce({
        ok: true as const,
        data: createSession({})
      });
    const harness = createHarness(createSession({ canSendInput: true }));

    await expect(harness.handleSendInput("continue")).resolves.toBe("session-a");

    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(sessionsApi.sendInput).toHaveBeenCalledTimes(2);
    const firstCommandId = vi.mocked(sessionsApi.sendInput).mock.calls[0]?.[2]?.commandId;
    const secondCommandId = vi.mocked(sessionsApi.sendInput).mock.calls[1]?.[2]?.commandId;
    expect(firstCommandId).toMatch(/^deskcue-/u);
    expect(secondCommandId).toMatch(/^deskcue-/u);
    expect(secondCommandId).not.toBe(firstCommandId);
  });

  it("recovers an accepted Generic managed input from history without offering a duplicate", async () => {
    sessionsApi.sendInput = vi.fn(() => Promise.resolve({
      ok: false as const,
      status: 409,
      data: { error: "remote_control_outcome_unknown" }
    }));
    const selectedSession = createSession({
      adapterId: "generic-cli",
      command: "local-agent",
      inputHistory: [],
      sourceSessionId: null
    });
    const recoveredSession = createSession({
      adapterId: "generic-cli",
      command: "local-agent",
      inputHistory: ["continue"],
      sourceSessionId: null
    });
    const harness = createHarness(selectedSession);
    harness.args.loadSession.mockResolvedValue(recoveredSession);

    await expect(harness.handleSendInput("continue")).resolves.toBe("session-a");

    expect(sessionsApi.sendInput).toHaveBeenCalledTimes(1);
    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(harness.args.setSelectedSession).toHaveBeenCalledWith(recoveredSession);
    expect(harness.promptDelivery.clearPromptDeliveryState).toHaveBeenCalled();
  });

  it("keeps an ambiguous source attach command when duplicate confirmation is declined", async () => {
    requestConfirmation.mockResolvedValue(false);
    agentSessionsApi.attach = vi.fn(() => Promise.resolve({
      ok: false as const,
      status: 409,
      data: { error: "remote_control_outcome_unknown" }
    }));
    const harness = createHarness(createSession({ canSendInput: false }));

    await expect(harness.handleSendInput("continue")).resolves.toBe(false);
    await expect(harness.handleSendInput("continue")).resolves.toBe(false);

    expect(requestConfirmation).toHaveBeenCalledTimes(2);
    const firstCommandId = vi.mocked(agentSessionsApi.attach).mock.calls[0]?.[2];
    const secondCommandId = vi.mocked(agentSessionsApi.attach).mock.calls[1]?.[2];
    expect(secondCommandId).toBe(firstCommandId);
  });

  it("does not rotate or mutate prompt state when duplicate confirmation becomes stale", async () => {
    const confirmation = deferred<boolean>();
    requestConfirmation.mockImplementation(() => confirmation.promise);
    sessionsApi.sendInput = vi.fn(() => Promise.resolve({
      ok: false as const,
      status: 409,
      data: { error: "remote_control_outcome_unknown" }
    }));
    const harness = createHarness(createSession({ canSendInput: true }));

    const pending = harness.handleSendInput("continue");
    await vi.waitFor(() => expect(requestConfirmation).toHaveBeenCalledTimes(1));
    harness.selectedSessionIdRef.current = "session-b";
    confirmation.resolve(true);

    await expect(pending).resolves.toBe(false);
    expect(sessionsApi.sendInput).toHaveBeenCalledTimes(1);
    expect(harness.promptDelivery.clearPromptDeliveryState).not.toHaveBeenCalled();
  });

  it("recovers an applied approval after reload without offering to apply it twice", async () => {
    sessionsApi.sendInput = vi.fn(() => Promise.resolve({
      ok: false as const,
      status: 409,
      data: { error: "remote_control_outcome_unknown" }
    }));
    const actionRequest = createActionRequest();
    const harness = createHarness(createSession({ actionRequest }));
    const recoveredSession = createSession({
      actionRequest: null,
      inputHistory: ["approve"]
    });
    harness.args.loadSession.mockResolvedValue(recoveredSession);

    await expect(harness.handleSendInput("approve", {
      actionDecision: "approve"
    })).resolves.toBe("session-a");

    expect(sessionsApi.sendInput).toHaveBeenCalledTimes(1);
    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(harness.args.setSelectedSession).toHaveBeenCalledWith(recoveredSession);
  });

  it("rotates a still-pending approval only after decision-specific confirmation", async () => {
    requestConfirmation.mockResolvedValue(true);
    sessionsApi.sendInput = vi.fn()
      .mockResolvedValueOnce({
        ok: false as const,
        status: 409,
        data: { error: "remote_control_outcome_unknown" }
      })
      .mockResolvedValueOnce({
        ok: true as const,
        data: createSession({ actionRequest: null })
      });
    const actionRequest = createActionRequest();
    const harness = createHarness(createSession({ actionRequest }));
    harness.args.loadSession.mockResolvedValue(createSession({ actionRequest }));

    await expect(harness.handleSendInput("approve", {
      actionDecision: "approve"
    })).resolves.toBe("session-a");

    expect(requestConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      confirmLabel: "Approve again",
      title: "Approve this request again?",
      tone: "danger"
    }));
    const firstCommandId = vi.mocked(sessionsApi.sendInput).mock.calls[0]?.[2]?.commandId;
    const secondCommandId = vi.mocked(sessionsApi.sendInput).mock.calls[1]?.[2]?.commandId;
    expect(secondCommandId).not.toBe(firstCommandId);
  });

  it("keeps a still-pending rejection command when decision confirmation is declined", async () => {
    requestConfirmation.mockResolvedValue(false);
    sessionsApi.sendInput = vi.fn(() => Promise.resolve({
      ok: false as const,
      status: 409,
      data: { error: "remote_control_outcome_unknown" }
    }));
    const actionRequest = createActionRequest();
    const harness = createHarness(createSession({ actionRequest }));
    harness.args.loadSession.mockResolvedValue(createSession({ actionRequest }));

    await expect(harness.handleSendInput("reject", {
      actionDecision: "reject"
    })).resolves.toBe(false);
    await expect(harness.handleSendInput("reject", {
      actionDecision: "reject"
    })).resolves.toBe(false);

    expect(requestConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      confirmLabel: "Reject again",
      title: "Reject this request again?"
    }));
    const firstCommandId = vi.mocked(sessionsApi.sendInput).mock.calls[0]?.[2]?.commandId;
    const secondCommandId = vi.mocked(sessionsApi.sendInput).mock.calls[1]?.[2]?.commandId;
    expect(secondCommandId).toBe(firstCommandId);
  });

  it("hydrates a replay marker before committing managed input state", async () => {
    sessionsApi.sendInput = vi.fn(() => Promise.resolve({
      ok: true as const,
      data: { accepted: true as const, sessionId: "session-a" }
    }));
    const hydrated = createSession({ status: "stopped" });
    const harness = createHarness(createSession({ canSendInput: true }));
    harness.args.loadSession.mockResolvedValue(hydrated);

    await expect(harness.handleSendInput("continue")).resolves.toBe("session-a");

    expect(harness.args.loadSession).toHaveBeenCalledWith("session-a", { sessionView: "chat" });
    expect(harness.args.setSelectedSession).toHaveBeenCalledWith(hydrated);
  });

  it("hydrates a replay marker before committing source attach state", async () => {
    agentSessionsApi.attach = vi.fn(() => Promise.resolve({
      ok: true as const,
      data: { accepted: true as const, sessionId: "managed-new" }
    }));
    const hydrated = createSession({ id: "managed-new" });
    const harness = createHarness(createSession({ canSendInput: false }));
    harness.args.loadSession.mockResolvedValue(hydrated);

    await expect(harness.handleSendInput("continue")).resolves.toBe("managed-new");

    expect(harness.args.loadSession).toHaveBeenCalledWith("managed-new", { sessionView: "chat" });
    expect(harness.args.setSelectedSession).toHaveBeenCalledWith(hydrated);
  });

  it("reports a replay marker whose session cannot be hydrated", async () => {
    sessionsApi.sendInput = vi.fn(() => Promise.resolve({
      ok: true as const,
      data: { accepted: true as const, sessionId: "session-a" }
    }));
    const harness = createHarness(createSession({ canSendInput: true }));
    harness.args.loadSession.mockResolvedValue(null as never);

    await expect(harness.handleSendInput("continue")).resolves.toBe(false);

    expect(harness.args.setSelectedSession).not.toHaveBeenCalled();
    expect(harness.args.setError).toHaveBeenCalledWith(expect.stringContaining("could not load"));
  });
});
