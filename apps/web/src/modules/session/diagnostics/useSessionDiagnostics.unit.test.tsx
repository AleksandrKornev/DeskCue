import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sessionsApi } from "@api/endpoint/sessions/endpoints";

import { useSessionDiagnostics } from "./useSessionDiagnostics";

vi.mock("@api/endpoint/sessions/endpoints", () => ({
  sessionsApi: {
    getOne: vi.fn()
  }
}));

const getOne = vi.mocked(sessionsApi.getOne);

describe("useSessionDiagnostics", () => {
  beforeEach(() => {
    getOne.mockReset();
    getOne.mockResolvedValue({
      id: "session-1",
      logs: [{
        id: "log-1",
        stream: "system",
        text: "Transport connected",
        timestamp: "2026-08-07T09:00:00.000Z"
      }],
      sourceSessionId: "source-1"
    } as never);
  });

  it("hydrates the bounded debug view only after Diagnostics opens", async () => {
    const { result, rerender } = renderHook(
      ({ isOpen }) => useSessionDiagnostics({
        fallbackEntries: [],
        isOpen,
        sessionId: "session-1"
      }),
      { initialProps: { isOpen: false } }
    );

    expect(getOne).not.toHaveBeenCalled();
    rerender({ isOpen: true });

    await waitFor(() => expect(result.current.entries[0]?.text).toBe("Transport connected"));
    expect(getOne).toHaveBeenCalledTimes(1);
    const options = getOne.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      debugLogTail: 80,
      view: "debug"
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
});
