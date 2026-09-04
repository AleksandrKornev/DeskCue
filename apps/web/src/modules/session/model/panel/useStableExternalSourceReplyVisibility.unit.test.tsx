import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXTERNAL_WAIT_INACTIVE_CONFIRMATION_DELAY_MS } from "./constants";
import { useStableExternalSourceReplyVisibility } from "./useStableExternalSourceReplyVisibility";

describe("useStableExternalSourceReplyVisibility", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const initialProps = {
    active: true,
    resetKey: "session-a:turn-a",
    terminalConfirmed: false
  };

  it("ignores a transient inactive snapshot after the waiting surface is visible", () => {
    const { result, rerender } = renderHook(
      ({ active, resetKey, terminalConfirmed }) => useStableExternalSourceReplyVisibility({
        hasExternalSourceReply: active,
        resetKey,
        terminalConfirmed
      }),
      { initialProps }
    );

    expect(result.current).toBe(true);

    rerender({ ...initialProps, active: false });
    act(() => vi.advanceTimersByTime(EXTERNAL_WAIT_INACTIVE_CONFIRMATION_DELAY_MS - 1));

    expect(result.current).toBe(true);

    rerender(initialProps);
    act(() => vi.advanceTimersByTime(1));

    expect(result.current).toBe(true);
  });

  it("hides after an inactive ownership state remains stable", () => {
    const { result, rerender } = renderHook(
      ({ active, resetKey, terminalConfirmed }) => useStableExternalSourceReplyVisibility({
        hasExternalSourceReply: active,
        resetKey,
        terminalConfirmed
      }),
      { initialProps }
    );

    rerender({ ...initialProps, active: false });
    act(() => vi.advanceTimersByTime(EXTERNAL_WAIT_INACTIVE_CONFIRMATION_DELAY_MS));

    expect(result.current).toBe(false);
  });

  it("hides the waiting surface synchronously after terminal confirmation", () => {
    const { result, rerender } = renderHook(
      ({ active, resetKey, terminalConfirmed }) => useStableExternalSourceReplyVisibility({
        hasExternalSourceReply: active,
        resetKey,
        terminalConfirmed
      }),
      { initialProps }
    );

    rerender({ ...initialProps, active: false, terminalConfirmed: true });

    expect(result.current).toBe(false);
  });

  it("shows a different active turn without an empty waiting gap", () => {
    const { result, rerender } = renderHook(
      ({ active, resetKey, terminalConfirmed }) => useStableExternalSourceReplyVisibility({
        hasExternalSourceReply: active,
        resetKey,
        terminalConfirmed
      }),
      { initialProps }
    );

    expect(result.current).toBe(true);

    rerender({ ...initialProps, resetKey: "session-b:turn-b" });
    expect(result.current).toBe(true);
  });

  it("shows an external turn immediately when ownership becomes active", () => {
    const { result, rerender } = renderHook(
      ({ active, resetKey, terminalConfirmed }) => useStableExternalSourceReplyVisibility({
        hasExternalSourceReply: active,
        resetKey,
        terminalConfirmed
      }),
      { initialProps: { ...initialProps, active: false } }
    );

    expect(result.current).toBe(false);

    rerender(initialProps);

    expect(result.current).toBe(true);
  });
});
