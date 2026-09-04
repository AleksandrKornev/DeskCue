import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PendingChatPrompt } from "@models/promptDelivery";

import { useReplyCompletionBridge } from "./useReplyCompletionBridge";

const waitingPrompt: PendingChatPrompt = {
  requestedAt: "2026-09-02T12:00:00.000Z",
  status: "waiting",
  text: "Keep the waiting surface continuous"
};

function ReplyCompletionBridgeHarness({
  isInterrupting = false,
  isWaiting,
  prompt
}: {
  isInterrupting?: boolean;
  isWaiting: boolean;
  prompt: PendingChatPrompt | null;
}) {
  const bridge = useReplyCompletionBridge({
    baseIsWaitingForChatReply: isWaiting,
    chatTranscriptEntries: [],
    currentWaitingPrompt: prompt,
    hasCurrentWaitingPromptAssistantReply: false,
    isInterruptingPrompt: isInterrupting
  });
  const isVisible = isWaiting || bridge.isReplyCompletionBridgeActive;

  return isVisible ? <div data-testid="waiting-surface">Waiting</div> : null;
}

describe("useReplyCompletionBridge", () => {
  it("does not unmount the waiting surface between source completion and transcript sync", async () => {
    const view = render(
      <ReplyCompletionBridgeHarness isWaiting prompt={waitingPrompt} />
    );
    const waitingSurface = screen.getByTestId("waiting-surface");
    let removedWaitingSurfaceCount = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const removedNode of record.removedNodes) {
          if (removedNode === waitingSurface || removedNode.contains?.(waitingSurface)) {
            removedWaitingSurfaceCount += 1;
          }
        }
      }
    });

    observer.observe(view.container, { childList: true, subtree: true });

    view.rerender(<ReplyCompletionBridgeHarness isWaiting={false} prompt={null} />);
    await act(async () => Promise.resolve());

    expect(screen.getByTestId("waiting-surface")).toBe(waitingSurface);
    expect(removedWaitingSurfaceCount).toBe(0);
    observer.disconnect();
  });

  it("does not retain a completion bridge when an interrupt starts", async () => {
    const view = render(
      <ReplyCompletionBridgeHarness isWaiting prompt={waitingPrompt} />
    );

    view.rerender(<ReplyCompletionBridgeHarness isWaiting={false} prompt={null} />);
    await act(async () => Promise.resolve());
    expect(screen.getByTestId("waiting-surface")).toBeInTheDocument();

    view.rerender(
      <ReplyCompletionBridgeHarness isInterrupting isWaiting={false} prompt={null} />
    );

    expect(screen.queryByTestId("waiting-surface")).not.toBeInTheDocument();
  });
});
