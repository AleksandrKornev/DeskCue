import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSessionDetail, SessionDetail } from "@deskcue/protocol";
import type { PendingChatPrompt } from "@models/promptDelivery";
import { PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS } from "@modules/dashboard/model/liveUpdates/helpers";

import {
  PROMPT_REPLY_WATCHDOG_HARD_TIMEOUT_MS,
  PROMPT_REPLY_WATCHDOG_RETRY_MS,
  PROMPT_REPLY_WATCHDOG_TERMINAL_GRACE_MS
} from "./constants";
import type { UseDashboardPromptReplyWatchdogArgs } from "./types";
import { useDashboardPromptReplyWatchdog } from "./useDashboardPromptReplyWatchdog";

const resourceMocks = vi.hoisted(() => ({ refreshNow: vi.fn() }));

vi.mock(
  "@modules/dashboard/model/chatDetail/resource/agentChatDetailResource",
  () => ({ agentChatDetailResource: { refreshNow: resourceMocks.refreshNow } })
);

const NOW = "2026-08-21T08:00:00.000Z";
const PROMPT_TEXT = "Add priority labels to the issue list";

function TestHarness({ args }: { args: UseDashboardPromptReplyWatchdogArgs }) {
  useDashboardPromptReplyWatchdog(args);
  return null;
}

function createSession(
  id = "managed-1",
  sourceSessionId: string | null = "source-1",
  patch: Partial<SessionDetail> = {}
) {
  return {
    adapterId: "codex",
    id,
    replyState: {
      phase: "waiting",
      promptText: PROMPT_TEXT,
      requestedAt: NOW
    },
    sourceSessionId,
    status: "running",
    ...patch
  } as SessionDetail;
}

function createPrompt(
  sessionId = "managed-1",
  sourceSessionId = "source-1",
  patch: Partial<PendingChatPrompt> = {}
) {
  return {
    requestedAt: NOW,
    sessionId,
    sourceSessionId,
    text: PROMPT_TEXT,
    ...patch
  } satisfies PendingChatPrompt;
}

function createAgentSession({
  completedAt,
  includePrompt = false,
  includeReply = false,
  phase = "active",
  sessionId = "codex:source-1"
}: {
  completedAt?: string;
  includePrompt?: boolean;
  includeReply?: boolean;
  phase?: "active" | "completed" | "failed" | "interrupted";
  sessionId?: string;
} = {}) {
  const transcript: AgentSessionDetail["transcript"] = [];

  if (includePrompt) {
    transcript.push({
      id: "user-current",
      role: "user",
      text: PROMPT_TEXT,
      timestamp: NOW
    } as AgentSessionDetail["transcript"][number]);
  }

  if (includeReply) {
    transcript.push({
      id: "assistant-current",
      phase: null,
      role: "assistant",
      text: "Implemented.",
      timestamp: "2026-08-21T08:00:01.000Z"
    });
  }

  return {
    id: sessionId,
    transcript,
    turnState: { completedAt, phase },
    workState: phase === "active" ? "running" : "idle"
  } as AgentSessionDetail;
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

function createHarnessArgs(
  selectedSession = createSession(),
  pendingChatPrompt: PendingChatPrompt | null = createPrompt()
) {
  const selectedSessionId = selectedSession.id;

  if (selectedSessionId === null) throw new Error("A managed session id is required by the watchdog test harness.");

  const sourceAgentSessionId = selectedSession.sourceSessionId
    ? `codex:${selectedSession.sourceSessionId}`
    : "";
  const args: UseDashboardPromptReplyWatchdogArgs = {
    activeTab: "overview",
    activeTabRef: { current: "overview" },
    activeTakenOverAgentSessionIdRef: { current: sourceAgentSessionId },
    activeTakenOverAgentSessionSummaryId: sourceAgentSessionId,
    applyFetchedAgentSessionDetail: vi.fn(),
    loadSessionRef: { current: vi.fn(() => Promise.resolve(selectedSession)) },
    pendingChatPrompt,
    promptReplyPollingActiveRef: { current: false },
    selectedAgentSessionIdRef: { current: sourceAgentSessionId },
    selectedSession,
    selectedSessionId,
    selectedSessionIdRef: { current: selectedSessionId }
  };

  return args;
}

async function advanceTime(durationMs: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(durationMs);
  });
}

describe("useDashboardPromptReplyWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resourceMocks.refreshNow.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not restart the initial timer across unrelated rerenders", async () => {
    resourceMocks.refreshNow.mockResolvedValue(createAgentSession({ includePrompt: true }));
    const args = createHarnessArgs();
    const view = render(<TestHarness args={args} />);

    await advanceTime(PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS - 3_000);
    for (let index = 0; index < 3; index += 1) {
      view.rerender(<TestHarness args={{
        ...args,
        pendingChatPrompt: { ...args.pendingChatPrompt! },
        selectedSession: { ...args.selectedSession! }
      }} />);
      await advanceTime(1_000);
    }

    expect(resourceMocks.refreshNow).toHaveBeenCalledTimes(1);
  });

  it("uses the actual agent session id as part of watch identity", async () => {
    resourceMocks.refreshNow.mockResolvedValue(null);
    const session = createSession("managed-1", null);
    const args = createHarnessArgs(
      session,
      createPrompt("managed-1", "source-1", { sourceSessionId: undefined })
    );

    args.activeTakenOverAgentSessionIdRef.current = "codex:source-1";
    args.activeTakenOverAgentSessionSummaryId = "codex:source-1";
    args.selectedAgentSessionIdRef.current = "codex:source-1";
    const view = render(<TestHarness args={args} />);

    await advanceTime(PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS);

    view.rerender(<TestHarness args={{
      ...args,
      activeTakenOverAgentSessionIdRef: { current: "codex:source-2" },
      activeTakenOverAgentSessionSummaryId: "codex:source-2",
      selectedAgentSessionIdRef: { current: "codex:source-2" }
    }} />);
    await advanceTime(PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS);

    expect(resourceMocks.refreshNow.mock.calls.map(([id]) => String(id))).toEqual([
      "codex:source-1",
      "codex:source-2"
    ]);
  });

  it("ignores an in-flight response after a session switch", async () => {
    const request = deferred<AgentSessionDetail | null>();

    resourceMocks.refreshNow.mockImplementationOnce(() => request.promise);
    const args = createHarnessArgs();
    const view = render(<TestHarness args={args} />);

    await advanceTime(PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS);

    const nextSession = createSession("managed-2", "source-2");

    args.selectedSessionIdRef.current = "managed-2";

    view.rerender(<TestHarness args={{
      ...args,
      activeTakenOverAgentSessionIdRef: { current: "codex:source-2" },
      activeTakenOverAgentSessionSummaryId: "codex:source-2",
      pendingChatPrompt: createPrompt("managed-2", "source-2"),
      selectedAgentSessionIdRef: { current: "codex:source-2" },
      selectedSession: nextSession,
      selectedSessionId: "managed-2"
    }} />);
    request.resolve(createAgentSession({ includePrompt: true, includeReply: true }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(args.applyFetchedAgentSessionDetail).not.toHaveBeenCalled();
    expect(args.loadSessionRef.current).not.toHaveBeenCalled();
  });

  it("ignores an in-flight response after unmount", async () => {
    const request = deferred<AgentSessionDetail | null>();

    resourceMocks.refreshNow.mockImplementationOnce(() => request.promise);
    const args = createHarnessArgs();
    const view = render(<TestHarness args={args} />);

    await advanceTime(PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS);

    view.unmount();
    request.resolve(createAgentSession({ includePrompt: true, includeReply: true }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(args.applyFetchedAgentSessionDetail).not.toHaveBeenCalled();
    expect(args.loadSessionRef.current).not.toHaveBeenCalled();
  });

  it("does not apply an in-flight result at the hard deadline", async () => {
    const request = deferred<AgentSessionDetail | null>();

    resourceMocks.refreshNow.mockImplementationOnce(() => request.promise);
    const args = createHarnessArgs();

    render(<TestHarness args={args} />);

    await advanceTime(PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS);
    await advanceTime(
      PROMPT_REPLY_WATCHDOG_HARD_TIMEOUT_MS - PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS
    );

    request.resolve(createAgentSession({ includePrompt: true, includeReply: true }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(args.applyFetchedAgentSessionDetail).not.toHaveBeenCalled();
    expect(args.loadSessionRef.current).not.toHaveBeenCalled();
    expect(args.promptReplyPollingActiveRef.current).toBe(false);
  });

  it("does not start a scheduled request at the hard deadline", async () => {
    resourceMocks.refreshNow.mockResolvedValue(createAgentSession({ includePrompt: true }));
    const args = createHarnessArgs();

    render(<TestHarness args={args} />);

    await advanceTime(PROMPT_REPLY_WATCHDOG_HARD_TIMEOUT_MS - 1);
    const callsBeforeDeadline = resourceMocks.refreshNow.mock.calls.length;

    await advanceTime(1);

    expect(resourceMocks.refreshNow).toHaveBeenCalledTimes(callsBeforeDeadline);
    expect(args.promptReplyPollingActiveRef.current).toBe(false);
  });

  it("does not treat a previous terminal turn without current prompt evidence as current", async () => {
    resourceMocks.refreshNow
      .mockResolvedValueOnce(createAgentSession({
        completedAt: "2026-08-21T08:00:01.000Z",
        phase: "completed"
      }))
      .mockResolvedValueOnce(createAgentSession({
        completedAt: "2026-08-21T08:00:01.000Z",
        phase: "completed"
      }))
      .mockResolvedValueOnce(createAgentSession({
        completedAt: "2026-08-21T08:00:01.000Z",
        phase: "completed"
      }))
      .mockResolvedValueOnce(createAgentSession({ includePrompt: true, includeReply: true }));
    const args = createHarnessArgs();

    render(<TestHarness args={args} />);

    await advanceTime(
      PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS + PROMPT_REPLY_WATCHDOG_RETRY_MS * 2
    );

    expect(args.loadSessionRef.current).not.toHaveBeenCalled();
    await advanceTime(PROMPT_REPLY_WATCHDOG_RETRY_MS);

    expect(args.loadSessionRef.current).toHaveBeenCalledTimes(1);
  });

  it("stops at terminal grace without marking a missing reply complete", async () => {
    resourceMocks.refreshNow.mockResolvedValue(createAgentSession({
      completedAt: "2026-08-21T08:00:01.000Z",
      includePrompt: true,
      phase: "completed"
    }));
    const session = createSession("managed-1", "source-1", { status: "read_only" });
    const args = createHarnessArgs(session);
    const view = render(<TestHarness args={args} />);

    await advanceTime(PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS);

    const idleSession = createSession("managed-1", "source-1", {
      replyState: { phase: "idle", promptText: null, requestedAt: null },
      status: "read_only"
    });

    view.rerender(<TestHarness args={{ ...args, selectedSession: idleSession }} />);
    await advanceTime(PROMPT_REPLY_WATCHDOG_TERMINAL_GRACE_MS - 1);
    expect(args.promptReplyPollingActiveRef.current).toBe(true);
    await advanceTime(1);

    expect(args.promptReplyPollingActiveRef.current).toBe(false);
    expect(args.loadSessionRef.current).not.toHaveBeenCalled();
  });

  it("keeps polling a phase-only terminal transition through its grace window", async () => {
    resourceMocks.refreshNow
      .mockResolvedValueOnce(createAgentSession({ includePrompt: true }))
      .mockResolvedValueOnce(createAgentSession({ includePrompt: true, includeReply: true }));
    const session = createSession("managed-1", "source-1", { status: "read_only" });
    const args = createHarnessArgs(session);
    const view = render(<TestHarness args={args} />);

    await advanceTime(PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS);

    view.rerender(<TestHarness args={{
      ...args,
      selectedSession: createSession("managed-1", "source-1", {
        replyState: { phase: "idle", promptText: null, requestedAt: null },
        status: "read_only"
      })
    }} />);
    await advanceTime(PROMPT_REPLY_WATCHDOG_RETRY_MS);

    expect(args.loadSessionRef.current).toHaveBeenCalledTimes(1);
  });

  it("retries transient errors after managed completion and before the hard deadline", async () => {
    resourceMocks.refreshNow
      .mockResolvedValueOnce(createAgentSession({ includePrompt: true }))
      .mockRejectedValueOnce(new Error("temporary network error"))
      .mockResolvedValueOnce(createAgentSession({ includePrompt: true, includeReply: true }));
    const args = createHarnessArgs();
    const view = render(<TestHarness args={args} />);

    await advanceTime(PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS);

    view.rerender(<TestHarness args={{
      ...args,
      selectedSession: createSession("managed-1", "source-1", {
        replyState: { phase: "idle", promptText: null, requestedAt: null },
        status: "read_only"
      })
    }} />);
    await advanceTime(PROMPT_REPLY_WATCHDOG_RETRY_MS * 2);

    expect(resourceMocks.refreshNow).toHaveBeenCalledTimes(3);
    expect(args.loadSessionRef.current).toHaveBeenCalledTimes(1);
  });

  it("retries a transient error only within extended terminal grace", async () => {
    resourceMocks.refreshNow
      .mockRejectedValueOnce(new Error("temporary network error"))
      .mockResolvedValue(createAgentSession({ phase: "completed" }));
    const args = createHarnessArgs();
    const view = render(<TestHarness args={args} />);

    await advanceTime(PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS);
    expect(resourceMocks.refreshNow).toHaveBeenCalledTimes(1);

    await advanceTime(
      PROMPT_REPLY_WATCHDOG_TERMINAL_GRACE_MS -
      PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS +
      1
    );

    view.rerender(<TestHarness args={{
      ...args,
      selectedSession: createSession("managed-1", "source-1", {
        replyState: { phase: "idle", promptText: null, requestedAt: null },
        status: "read_only"
      })
    }} />);

    await advanceTime(PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS);
    expect(resourceMocks.refreshNow).toHaveBeenCalledTimes(2);

    const remainingGraceMs = PROMPT_REPLY_WATCHDOG_TERMINAL_GRACE_MS -
      PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS;
    await advanceTime(remainingGraceMs - 1);
    const callsBeforeGraceDeadline = resourceMocks.refreshNow.mock.calls.length;

    await advanceTime(1);
    expect(resourceMocks.refreshNow).toHaveBeenCalledTimes(callsBeforeGraceDeadline);
    await advanceTime(PROMPT_REPLY_WATCHDOG_RETRY_MS);

    expect(resourceMocks.refreshNow).toHaveBeenCalledTimes(callsBeforeGraceDeadline);
    expect(args.promptReplyPollingActiveRef.current).toBe(false);
    expect(args.loadSessionRef.current).not.toHaveBeenCalled();
  });
});
