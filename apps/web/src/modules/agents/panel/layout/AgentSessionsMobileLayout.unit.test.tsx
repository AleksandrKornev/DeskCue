import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeskCueLayoutModeProvider } from "@web/layout";

import { AgentSessionsMobileLayout } from "./AgentSessionsMobileLayout";

function renderLayout(
  showFocusedDetail: boolean,
  onBackToChats = vi.fn(),
  agentSessionLabel = "Build release"
) {
  const view = render(
    <DeskCueLayoutModeProvider mode="embedded">
      <div data-deskcue-remote-root="">
        <AgentSessionsMobileLayout
          agentSessionId="session-1"
          agentSessionLabel={agentSessionLabel}
          sessionsList={(
            <div>
              <h2 data-chat-list-focus-fallback="" tabIndex={-1}>Control room</h2>
              <span>Chat list</span>
              <button data-chat-list-item-id="session-1" type="button">Build release</button>
            </div>
          )}
          showFocusedDetail={showFocusedDetail}
          transcriptPanel={<div>Selected transcript</div>}
          onBackToChats={onBackToChats}
        />
      </div>
    </DeskCueLayoutModeProvider>
  );
  const remoteRoot = view.container.querySelector<HTMLElement>("[data-deskcue-remote-root]");

  if (remoteRoot) remoteRoot.scrollTo = vi.fn();

  return { onBackToChats, ...view };
}

describe("AgentSessionsMobileLayout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("switches from the list to a focused detail instead of stacking both", () => {
    renderLayout(true);

    expect(screen.getByText("Selected transcript")).toBeInTheDocument();
    expect(screen.queryByText("Chat list")).not.toBeInTheDocument();
  });

  it("returns to the list through Back to chats", () => {
    vi.useFakeTimers();
    const { onBackToChats, rerender } = renderLayout(true);

    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByRole("button", { name: "Back to chats" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Back to chats" }));
    expect(onBackToChats).toHaveBeenCalledOnce();

    rerender(
      <DeskCueLayoutModeProvider mode="embedded">
        <div data-deskcue-remote-root="">
          <AgentSessionsMobileLayout
            agentSessionId=""
            agentSessionLabel=""
            sessionsList={(
              <div>
                <h2 data-chat-list-focus-fallback="" tabIndex={-1}>Control room</h2>
                <span>Chat list</span>
                <button data-chat-list-item-id="session-1" type="button">Build release</button>
              </div>
            )}
            showFocusedDetail={false}
            transcriptPanel={null}
            onBackToChats={onBackToChats}
          />
        </div>
      </DeskCueLayoutModeProvider>
    );

    expect(screen.getByText("Chat list")).toBeInTheDocument();
    expect(screen.queryByText("Selected transcript")).not.toBeInTheDocument();

    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByRole("button", { name: "Build release" })).toHaveFocus();
  });

  it("falls back to the browser heading when the previous card is no longer rendered", () => {
    vi.useFakeTimers();
    const { onBackToChats, rerender } = renderLayout(true);

    act(() => {
      vi.runAllTimers();
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to chats" }));

    rerender(
      <DeskCueLayoutModeProvider mode="embedded">
        <div data-deskcue-remote-root="">
          <AgentSessionsMobileLayout
            agentSessionId=""
            agentSessionLabel=""
            sessionsList={<h2 data-chat-list-focus-fallback="" tabIndex={-1}>Control room</h2>}
            showFocusedDetail={false}
            transcriptPanel={null}
            onBackToChats={onBackToChats}
          />
        </div>
      </DeskCueLayoutModeProvider>
    );

    expect(screen.getByRole("heading", { name: "Control room" })).toHaveFocus();
  });

  it("names the focused detail and moves unowned focus to Back", () => {
    vi.useFakeTimers();
    renderLayout(true);

    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByRole("heading", { name: "Build release" })).toBeInTheDocument();
    expect(screen.getByText("Build release", { selector: "span" })).toHaveAttribute(
      "aria-hidden",
      "true"
    );

    expect(screen.getByRole("button", { name: "Back to chats" })).toHaveFocus();
  });

  it("uses a stable fallback for a whitespace-only detail label", () => {
    renderLayout(true, vi.fn(), "   ");

    expect(screen.getByRole("heading", { name: "Selected chat" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Selected chat" })).toBeInTheDocument();
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
