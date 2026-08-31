import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { copyTextMock } = vi.hoisted(() => ({
  copyTextMock: vi.fn()
}));

vi.mock("@lib/clipboard", () => ({
  copyText: copyTextMock
}));

import { useMessageCopyFeedback } from "./useMessageCopyFeedback";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    }
  };
}

function CopyFeedbackHarness({ ownerKey = "session-a" }: { ownerKey?: string }) {
  const { copyFeedback, handleCopyMessage } = useMessageCopyFeedback(ownerKey);

  return (
    <>
      <button onClick={() => void handleCopyMessage("message-a", "Message A")} type="button">
        Copy A
      </button>
      <button onClick={() => void handleCopyMessage("message-b", "Message B")} type="button">
        Copy B
      </button>
      <output>{copyFeedback ? `${copyFeedback.messageId}:${copyFeedback.status}` : "none"}</output>
    </>
  );
}

describe("useMessageCopyFeedback", () => {
  it("keeps feedback for the latest Copy when earlier clipboard work finishes last", async () => {
    const firstCopy = createDeferred<boolean>();
    const secondCopy = createDeferred<boolean>();

    copyTextMock
      .mockImplementationOnce(() => firstCopy.promise)
      .mockImplementationOnce(() => secondCopy.promise);

    render(<CopyFeedbackHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Copy A" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy B" }));

    await act(async () => {
      secondCopy.resolve(true);
      await secondCopy.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("message-b:copied");
    });

    await act(async () => {
      firstCopy.resolve(false);
      await firstCopy.promise;
    });

    expect(screen.getByRole("status")).toHaveTextContent("message-b:copied");
  });

  it("invalidates pending Copy feedback when the session owner changes", async () => {
    const pendingCopy = createDeferred<boolean>();

    copyTextMock.mockImplementationOnce(() => pendingCopy.promise);

    const view = render(<CopyFeedbackHarness ownerKey="session-a" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy A" }));
    view.rerender(<CopyFeedbackHarness ownerKey="session-b" />);

    expect(screen.getByRole("status")).toHaveTextContent("none");

    await act(async () => {
      pendingCopy.resolve(true);
      await pendingCopy.promise;
    });

    expect(screen.getByRole("status")).toHaveTextContent("none");
  });

  it("hides completed Copy feedback immediately when the session owner changes", async () => {
    copyTextMock.mockResolvedValueOnce(true);

    const view = render(<CopyFeedbackHarness ownerKey="session-a" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy A" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("message-a:copied");
    });

    view.rerender(<CopyFeedbackHarness ownerKey="session-b" />);

    expect(screen.getByRole("status")).toHaveTextContent("none");
  });
});
