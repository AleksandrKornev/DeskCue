import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SessionDetail, SessionSummary } from "@deskcue/protocol";

import { useManagedSessionShellViewModel } from "./useManagedSessionShellViewModel";

function createSummary(id: string, workspaceName: string): SessionSummary {
  return {
    id,
    workspaceName
  } as SessionSummary;
}

function createDetail(id: string): SessionDetail {
  return {
    id,
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
