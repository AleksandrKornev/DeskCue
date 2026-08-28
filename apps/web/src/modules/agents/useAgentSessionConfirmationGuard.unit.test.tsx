import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ConfirmationOptions,
  ConfirmationRequestLifecycle
} from "@components/ModalDialog";

import { useAgentSessionConfirmationGuard } from "./useAgentSessionConfirmationGuard";

const requestConfirmation = vi.hoisted(() => vi.fn());

vi.mock("@components/ModalDialog", () => ({ requestConfirmation }));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

describe("useAgentSessionConfirmationGuard", () => {
  beforeEach(() => {
    requestConfirmation.mockReset();
  });

  it("invalidates a pending confirmation when source access changes", async () => {
    const confirmation = createDeferred<boolean>();
    let signal: AbortSignal | undefined;

    requestConfirmation.mockImplementation((
      _options: ConfirmationOptions,
      lifecycle: ConfirmationRequestLifecycle
    ) => {
      signal = lifecycle.signal;
      return confirmation.promise;
    });
    const { result, rerender } = renderHook(
      ({ accessKey }) => useAgentSessionConfirmationGuard({
        accessKey,
        sessionId: "session-1"
      }),
      { initialProps: { accessKey: "resume:running" } }
    );

    let pendingConfirmation!: Promise<boolean>;

    act(() => {
      pendingConfirmation = result.current({
        confirmLabel: "Open observation view",
        title: "Open observation view?"
      });
    });

    rerender({ accessKey: "resume:idle" });
    expect(signal?.aborted).toBe(true);

    confirmation.resolve(true);
    await expect(pendingConfirmation).resolves.toBe(false);
  });
});
