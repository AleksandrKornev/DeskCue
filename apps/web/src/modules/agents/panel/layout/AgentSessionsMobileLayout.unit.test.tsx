import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DeskCueLayoutModeProvider } from "@web/layout";

import { AgentSessionsMobileLayout } from "./AgentSessionsMobileLayout";

function renderLayout(showFocusedDetail: boolean, onBackToChats = vi.fn()) {
  return {
    onBackToChats,
    ...render(
      <DeskCueLayoutModeProvider mode="embedded">
        <div data-deskcue-remote-root="">
          <AgentSessionsMobileLayout
            agentSessionId="session-1"
            agentSessionLabel="Build release"
            sessionsList={<div>Chat list</div>}
            showFocusedDetail={showFocusedDetail}
            transcriptPanel={<div>Selected transcript</div>}
            onBackToChats={onBackToChats}
          />
        </div>
      </DeskCueLayoutModeProvider>
    )
  };
}

describe("AgentSessionsMobileLayout", () => {
  it("switches from the list to a focused detail instead of stacking both", () => {
    renderLayout(true);

    expect(screen.getByText("Selected transcript")).toBeInTheDocument();
    expect(screen.queryByText("Chat list")).not.toBeInTheDocument();
  });

  it("returns to the list through Back to chats", () => {
    const { onBackToChats, rerender } = renderLayout(true);

    fireEvent.click(screen.getByRole("button", { name: "Back to chats" }));
    expect(onBackToChats).toHaveBeenCalledOnce();

    rerender(
      <DeskCueLayoutModeProvider mode="embedded">
        <div data-deskcue-remote-root="">
          <AgentSessionsMobileLayout
            agentSessionId=""
            agentSessionLabel=""
            sessionsList={<div>Chat list</div>}
            showFocusedDetail={false}
            transcriptPanel={null}
            onBackToChats={onBackToChats}
          />
        </div>
      </DeskCueLayoutModeProvider>
    );
    expect(screen.getByText("Chat list")).toBeInTheDocument();
    expect(screen.queryByText("Selected transcript")).not.toBeInTheDocument();
  });

  it("scrolls the embedded root to the selected detail without scrolling window", () => {
    vi.useFakeTimers();
    const windowScroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const { container } = renderLayout(true);
    const remoteRoot = container.querySelector<HTMLElement>("[data-deskcue-remote-root]");
    const detail = screen.getByRole("button", { name: "Back to chats" }).parentElement?.parentElement;
    expect(remoteRoot).not.toBeNull();
    expect(detail).not.toBeNull();
    if (!remoteRoot || !detail) return;

    Object.defineProperties(remoteRoot, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_200 },
      scrollTop: { configurable: true, value: 300, writable: true }
    });
    vi.spyOn(remoteRoot, "getBoundingClientRect").mockReturnValue({
      bottom: 400,
      height: 400,
      left: 0,
      right: 360,
      top: 0,
      width: 360,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    vi.spyOn(detail, "getBoundingClientRect").mockReturnValue({
      bottom: 900,
      height: 400,
      left: 0,
      right: 360,
      top: 500,
      width: 360,
      x: 0,
      y: 500,
      toJSON: () => ({})
    });
    const rootScroll = vi.fn();
    remoteRoot.scrollTo = rootScroll;

    act(() => {
      vi.runAllTimers();
    });

    expect(rootScroll).toHaveBeenCalledWith({ top: 788, behavior: "auto" });
    expect(windowScroll).not.toHaveBeenCalled();
  });
});
