import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentSessionDetail, SessionDetail } from "@deskcue/protocol";
import type { PendingChatPrompt } from "@models/promptDelivery";

vi.mock("@modules/dashboard/model/prompt/sessionSync", () => ({
  useDashboardPromptSessionSync: () => undefined
}));

import { useDashboardPromptState } from "./useDashboardPromptState";

const prompt: PendingChatPrompt = {
  text: "Prompt that must remain visible after stop",
  requestedAt: "2026-08-05T12:00:00.000Z",
  sessionId: "managed-1",
  sourceSessionId: "source-1",
  status: "waiting"
};

const session = {
  id: "managed-1",
  sourceSessionId: "source-1",
  status: "running",
  replyState: {
    phase: "waiting",
    promptText: prompt.text,
    requestedAt: prompt.requestedAt
  }
} as unknown as SessionDetail;

describe("useDashboardPromptState", () => {
  it("captures an owned prompt synchronously before stop clears pending delivery state", () => {
    let state!: ReturnType<typeof useDashboardPromptState>;

    function Probe() {
      state = useDashboardPromptState(
        "managed-1",
        session,
        null,
        { pendingChatPrompt: prompt }
      );
      return null;
    }

    render(<Probe />);

    act(() => {
      state.setIsInterruptingPrompt(true);
      state.setPendingChatPrompt(null);
      state.setIsWaitingForChatReply(false);
      state.setIsInterruptingPrompt(false);
    });

    expect(state.immediateInterruptPrompt).toMatchObject({
      text: prompt.text,
      requestedAt: prompt.requestedAt,
      sessionId: "managed-1",
      sourceSessionId: "source-1"
    });
  });

  it("clears interrupt state when the selected source session changes", () => {
    const sourceA = {
      id: "codex:source-1",
      sourceSessionId: "source-1",
      transcript: []
    } as unknown as AgentSessionDetail;
    const sourceB = {
      id: "codex:source-2",
      sourceSessionId: "source-2",
      transcript: []
    } as unknown as AgentSessionDetail;
    const selectedSession = {
      ...session,
      sourceSessionId: "source-1"
    } as SessionDetail;
    const { result, rerender } = renderHook(
      ({ sourceSession }) => useDashboardPromptState(
        "managed-1",
        selectedSession,
        sourceSession,
        {}
      ),
      { initialProps: { sourceSession: sourceA } }
    );

    act(() => {
      result.current.setIsInterruptingPrompt(true);
    });
    expect(result.current.isInterruptingPrompt).toBe(true);

    rerender({ sourceSession: sourceB });

    expect(result.current.isInterruptingPrompt).toBe(false);
  });

  it("keeps interrupt state scoped to the managed source while source detail is loading", () => {
    const { result } = renderHook(() => useDashboardPromptState(
      "managed-1",
      session,
      null,
      {}
    ));

    act(() => {
      result.current.setIsInterruptingPrompt(true);
    });

    expect(result.current.isInterruptingPrompt).toBe(true);
  });
});
