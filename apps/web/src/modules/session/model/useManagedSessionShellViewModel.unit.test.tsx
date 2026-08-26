import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SessionDetail, SessionSummary } from "@deskcue/protocol";

import { useManagedSessionShellViewModel } from "./useManagedSessionShellViewModel";

function createSummary(id: string, workspaceName: string): SessionSummary {
  return {
    actionRequest: null,
    canSendInput: true,
    exitCode: null,
    finishedAt: null,
    id,
    inputBlockedReason: null,
    lastActivityAt: "2026-08-22T08:00:00.000Z",
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    },
    status: "running",
    workspaceName
  } as SessionSummary;
}

function createDetail(id: string): SessionDetail {
  return {
    actionRequest: null,
    canSendInput: true,
    exitCode: null,
    finishedAt: null,
    id,
    inputBlockedReason: null,
    lastActivityAt: "2026-08-22T08:00:00.000Z",
    replyState: {
      phase: "idle",
      promptText: null,
      requestedAt: null
    },
    sourceSessionId: "source-1",
    status: "running",
    workspaceName: "Source chat workspace"
  } as SessionDetail;
}

type ShellHarnessProps = {
  managedSessions: SessionSummary[];
  selectedSession: SessionDetail | null;
  selectedSessionId: string;
};

describe("useManagedSessionShellViewModel", () => {
  it("keeps the matching detail while a tab-only route transition refreshes it", () => {
    const detail = createDetail("session-1");
    const summary = createSummary("session-1", "Generic workspace");
    const initialProps: ShellHarnessProps = {
      managedSessions: [summary],
      selectedSession: detail,
      selectedSessionId: "session-1"
    };

    const { result, rerender } = renderHook(
      (props: ShellHarnessProps) => useManagedSessionShellViewModel(props),
      { initialProps }
    );

    rerender({ ...initialProps, selectedSession: null });

    expect(result.current.selectedSessionDetail).toBe(detail);
    expect(result.current.sessionShell).toBe(detail);
    expect(result.current.isSessionShellLoading).toBe(false);
  });

  it("applies a newer realtime lifecycle summary to a retained detail", () => {
    const detail = {
      ...createDetail("session-1"),
      canSendInput: false,
      finishedAt: "2026-08-22T08:00:00.000Z",
      status: "read_only" as const
    };

    const summary = {
      ...createSummary("session-1", "Source chat workspace"),
      actionRequest: null,
      canSendInput: true,
      exitCode: 0,
      finishedAt: null,
      inputBlockedReason: null,
      lastActivityAt: "2026-08-22T08:00:01.000Z",
      replyState: {
        phase: "idle" as const,
        promptText: null,
        requestedAt: null
      },
      status: "stopped" as const
    };

    const { result } = renderHook(() => useManagedSessionShellViewModel({
      managedSessions: [summary],
      selectedSession: detail,
      selectedSessionId: detail.id
    }));

    expect(result.current.selectedSessionDetail?.status).toBe("stopped");
    expect(result.current.selectedSessionDetail?.finishedAt).toBeNull();
    expect(result.current.selectedSessionDetail?.canSendInput).toBe(true);
    expect(result.current.sessionShell).toBe(result.current.selectedSessionDetail);
  });

  it("applies an equal-timestamp realtime lifecycle summary to a retained detail", () => {
    const detail = {
      ...createDetail("session-1"),
      canSendInput: true,
      finishedAt: null,
      status: "running" as const
    };

    const summary = {
      ...createSummary("session-1", "Source chat workspace"),
      actionRequest: null,
      canSendInput: false,
      exitCode: 0,
      finishedAt: "2026-08-22T08:00:00.000Z",
      inputBlockedReason: "This session is not accepting input.",
      replyState: {
        phase: "idle" as const,
        promptText: null,
        requestedAt: null
      },
      status: "done" as const
    };

    const { result } = renderHook(() => useManagedSessionShellViewModel({
      managedSessions: [summary],
      selectedSession: detail,
      selectedSessionId: detail.id
    }));

    expect(result.current.selectedSessionDetail?.status).toBe("done");
    expect(result.current.selectedSessionDetail?.finishedAt).toBe(summary.finishedAt);
    expect(result.current.selectedSessionDetail?.canSendInput).toBe(false);
  });

  it("does not regress an equal-timestamp terminal detail to a running summary", () => {
    const detail = {
      ...createDetail("session-1"),
      canSendInput: false,
      exitCode: 0,
      finishedAt: "2026-08-22T08:00:00.000Z",
      inputBlockedReason: "This session is not accepting input.",
      status: "done" as const
    };

    const summary = createSummary("session-1", "Source chat workspace");
    const { result } = renderHook(() => useManagedSessionShellViewModel({
      managedSessions: [summary],
      selectedSession: detail,
      selectedSessionId: detail.id
    }));

    expect(result.current.selectedSessionDetail).toBe(detail);
    expect(result.current.selectedSessionDetail?.status).toBe("done");
    expect(result.current.selectedSessionDetail?.canSendInput).toBe(false);
  });

  it("does not leak a preserved detail into another or removed session", () => {
    const detail = createDetail("session-1");
    const firstSummary = createSummary("session-1", "First workspace");
    const secondSummary = createSummary("session-2", "Second workspace");
    const initialProps: ShellHarnessProps = {
      managedSessions: [firstSummary, secondSummary],
      selectedSession: detail,
      selectedSessionId: "session-1"
    };

    const { result, rerender } = renderHook(
      (props: ShellHarnessProps) => useManagedSessionShellViewModel(props),
      { initialProps }
    );

    rerender({
      managedSessions: [firstSummary, secondSummary],
      selectedSession: null,
      selectedSessionId: "session-2"
    });

    expect(result.current.selectedSessionDetail).toBeNull();
    expect(result.current.sessionShell).toBe(secondSummary);

    rerender({
      managedSessions: [],
      selectedSession: null,
      selectedSessionId: "session-2"
    });

    expect(result.current.sessionShell).toBeNull();
  });
});
