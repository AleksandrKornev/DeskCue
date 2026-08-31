import { render, screen } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { describe, expect, it } from "vitest";

import { useAgentBrowserCompactFocusHandoff } from "./useAgentBrowserCompactFocusHandoff";

interface FocusHandoffHarnessProps {
  autoFocusListTarget?: boolean;
  isCompactViewport: boolean;
  renderAttentionExactTarget?: boolean;
  renderAttentionOnlyTarget?: boolean;
  renderCollapsedTarget?: boolean;
  renderExactTarget?: boolean;
  renderHideAction?: boolean;
  renderLoadingTarget?: boolean;
  renderRecoveryTarget?: boolean;
  showFocusedDetail?: boolean;
}

interface FocusHandoffListProps {
  autoFocusTarget: boolean;
  isCompactViewport: boolean;
  renderExactTarget: boolean;
}

function FocusHandoffList({
  autoFocusTarget,
  isCompactViewport,
  renderExactTarget
}: FocusHandoffListProps) {
  const automaticTargetRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (autoFocusTarget) automaticTargetRef.current?.focus();
  }, [autoFocusTarget]);

  return (
    <div
      key={isCompactViewport ? "compact-list" : "desktop-list"}
      data-chat-list-focus-scope=""
    >
      {renderExactTarget ? (
        <>
          <button
            data-chat-list-item-id="session-1"
            ref={automaticTargetRef}
            type="button"
          >
            Build release
          </button>
          <button data-chat-list-item-id="session-2" type="button">Review patch</button>
        </>
      ) : null}
      <button type="button">Load more chats</button>
    </div>
  );
}

function FocusHandoffHarness({
  autoFocusListTarget = false,
  isCompactViewport,
  renderAttentionExactTarget = true,
  renderAttentionOnlyTarget = false,
  renderCollapsedTarget = false,
  renderExactTarget = true,
  renderHideAction = false,
  renderLoadingTarget = false,
  renderRecoveryTarget = false,
  showFocusedDetail = isCompactViewport
}: FocusHandoffHarnessProps) {
  useAgentBrowserCompactFocusHandoff({
    focusTargetId: "session-1",
    focusSurfaceKey: renderCollapsedTarget
      ? "collapsed"
      : showFocusedDetail
        ? "detail"
        : renderRecoveryTarget
          ? "recovery"
          : renderLoadingTarget ? "loading" : "list",
    isCompactViewport,
    showFocusedDetail: !renderCollapsedTarget && showFocusedDetail
  });

  return (
    <div data-agent-browser-focus-root="">
      <button type="button">Persistent action</button>
      {renderHideAction && !renderCollapsedTarget ? (
        <button
          data-chat-list-focus-owner=""
          type="button"
        >
          Hide chat browser
        </button>
      ) : null}
      {renderCollapsedTarget || isCompactViewport && showFocusedDetail ? null : (
        <h2 data-chat-list-focus-fallback="" tabIndex={-1}>Control room</h2>
      )}
      {renderCollapsedTarget ? (
        <button
          data-chat-list-focus-fallback=""
          data-chat-list-focus-priority=""
          type="button"
        >
          Browse agent chats
        </button>
      ) : isCompactViewport && showFocusedDetail ? (
        <button
          data-chat-list-focus-fallback=""
          data-chat-list-focus-priority=""
          type="button"
        >
          Back to chats
        </button>
      ) : renderRecoveryTarget ? (
        <button
          data-chat-list-focus-fallback=""
          data-chat-list-focus-priority=""
          type="button"
        >
          Retry
        </button>
      ) : renderLoadingTarget ? (
        <div
          data-chat-list-focus-fallback=""
          data-chat-list-focus-priority=""
          tabIndex={-1}
        >
          Loading chats
        </div>
      ) : renderAttentionOnlyTarget ? (
        <>
          <button type="button">Active agents</button>
          <button
            data-chat-list-item-id={renderAttentionExactTarget ? "session-1" : "other-session"}
            type="button"
          >
            {renderAttentionExactTarget ? "Attention session" : "Other attention session"}
          </button>
          <div aria-hidden="true" />
        </>
      ) : (
        <FocusHandoffList
          autoFocusTarget={autoFocusListTarget}
          isCompactViewport={isCompactViewport}
          renderExactTarget={renderExactTarget}
        />
      )}
    </div>
  );
}

describe("useAgentBrowserCompactFocusHandoff", () => {
  it("moves focus from the removed mobile Back button to the exact desktop card", () => {
    const { rerender } = render(<FocusHandoffHarness isCompactViewport />);

    screen.getByRole("button", { name: "Back to chats" }).focus();
    rerender(<FocusHandoffHarness isCompactViewport={false} />);

    expect(screen.getByRole("button", { name: "Build release" })).toHaveFocus();
  });

  it("moves focus from an active detail to the collapsed browser action", () => {
    const { rerender } = render(<FocusHandoffHarness isCompactViewport />);

    screen.getByRole("button", { name: "Back to chats" }).focus();
    rerender(
      <FocusHandoffHarness
        isCompactViewport
        renderCollapsedTarget
      />
    );

    expect(screen.getByRole("button", { name: "Browse agent chats" })).toHaveFocus();
  });

  it("moves focus from the expanded Hide action to the collapsed browser action", () => {
    const { rerender } = render(
      <FocusHandoffHarness
        isCompactViewport
        renderHideAction
        showFocusedDetail={false}
      />
    );

    screen.getByRole("button", { name: "Hide chat browser" }).focus();
    rerender(
      <FocusHandoffHarness
        isCompactViewport
        renderCollapsedTarget
        renderHideAction
        showFocusedDetail={false}
      />
    );

    expect(screen.getByRole("button", { name: "Browse agent chats" })).toHaveFocus();
  });

  it("returns focus from the collapsed action to the expanded browser", () => {
    const { rerender } = render(
      <FocusHandoffHarness
        isCompactViewport
        renderCollapsedTarget
        showFocusedDetail={false}
      />
    );

    screen.getByRole("button", { name: "Browse agent chats" }).focus();
    rerender(
      <FocusHandoffHarness
        isCompactViewport
        renderHideAction
        showFocusedDetail={false}
      />
    );

    expect(screen.getByRole("heading", { name: "Control room" })).toHaveFocus();
  });

  it("uses the desktop browser heading when the exact card is absent", () => {
    const { rerender } = render(<FocusHandoffHarness isCompactViewport />);

    screen.getByRole("button", { name: "Back to chats" }).focus();
    rerender(<FocusHandoffHarness isCompactViewport={false} renderExactTarget={false} />);

    expect(screen.getByRole("heading", { name: "Control room" })).toHaveFocus();
  });

  it("moves focus to recovery when closing detail into an unavailable compact state", () => {
    const { rerender } = render(<FocusHandoffHarness isCompactViewport />);

    screen.getByRole("button", { name: "Back to chats" }).focus();
    rerender(
      <FocusHandoffHarness
        isCompactViewport
        renderRecoveryTarget
        showFocusedDetail={false}
      />
    );

    expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();
  });

  it("restores list focus after the recovery action is replaced", () => {
    const { rerender } = render(<FocusHandoffHarness isCompactViewport />);

    screen.getByRole("button", { name: "Back to chats" }).focus();
    rerender(
      <FocusHandoffHarness
        isCompactViewport
        renderRecoveryTarget
        showFocusedDetail={false}
      />
    );

    expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();

    rerender(<FocusHandoffHarness isCompactViewport showFocusedDetail={false} />);

    expect(screen.getByRole("button", { name: "Build release" })).toHaveFocus();
  });

  it("preserves the exact target through Retry and Loading into attention-only recovery", () => {
    const { rerender } = render(<FocusHandoffHarness isCompactViewport />);

    screen.getByRole("button", { name: "Back to chats" }).focus();
    rerender(
      <FocusHandoffHarness
        isCompactViewport
        renderRecoveryTarget
        showFocusedDetail={false}
      />
    );

    expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();

    rerender(
      <FocusHandoffHarness
        isCompactViewport
        renderLoadingTarget
        showFocusedDetail={false}
      />
    );

    expect(screen.getByText("Loading chats")).toHaveFocus();

    rerender(
      <FocusHandoffHarness
        isCompactViewport
        renderAttentionOnlyTarget
        showFocusedDetail={false}
      />
    );

    expect(screen.getByRole("button", { name: "Attention session" })).toHaveFocus();
  });

  it("falls back to the stable browser heading when the recovered exact target is gone", () => {
    const { rerender } = render(<FocusHandoffHarness isCompactViewport />);

    screen.getByRole("button", { name: "Back to chats" }).focus();
    rerender(
      <FocusHandoffHarness
        isCompactViewport
        renderRecoveryTarget
        showFocusedDetail={false}
      />
    );

    rerender(
      <FocusHandoffHarness
        isCompactViewport
        renderLoadingTarget
        showFocusedDetail={false}
      />
    );

    rerender(
      <FocusHandoffHarness
        isCompactViewport
        renderAttentionExactTarget={false}
        renderAttentionOnlyTarget
        showFocusedDetail={false}
      />
    );

    expect(screen.getByRole("heading", { name: "Control room" })).toHaveFocus();
  });

  it("preserves focus already owned by another persistent control", () => {
    const { rerender } = render(<FocusHandoffHarness isCompactViewport />);
    const persistentAction = screen.getByRole("button", { name: "Persistent action" });

    persistentAction.focus();
    rerender(<FocusHandoffHarness isCompactViewport={false} />);

    expect(persistentAction).toHaveFocus();
  });

  it("hands off the current list card instead of a stale detail target", () => {
    const { rerender } = render(<FocusHandoffHarness isCompactViewport />);

    screen.getByRole("button", { name: "Back to chats" }).focus();
    rerender(<FocusHandoffHarness isCompactViewport showFocusedDetail={false} />);
    screen.getByRole("button", { name: "Review patch" }).focus();
    rerender(<FocusHandoffHarness isCompactViewport={false} showFocusedDetail={false} />);

    expect(screen.getByRole("button", { name: "Review patch" })).toHaveFocus();
  });

  it("falls back to the heading when a non-card list control is replaced", () => {
    const { rerender } = render(
      <FocusHandoffHarness isCompactViewport showFocusedDetail={false} />
    );

    screen.getByRole("button", { name: "Load more chats" }).focus();
    rerender(<FocusHandoffHarness isCompactViewport={false} showFocusedDetail={false} />);

    expect(screen.getByRole("heading", { name: "Control room" })).toHaveFocus();
  });

  it("keeps the automatic Back return target across the next breakpoint change", () => {
    const { rerender } = render(<FocusHandoffHarness isCompactViewport />);

    screen.getByRole("button", { name: "Back to chats" }).focus();
    rerender(
      <FocusHandoffHarness
        autoFocusListTarget
        isCompactViewport
        showFocusedDetail={false}
      />
    );

    expect(screen.getByRole("button", { name: "Build release" })).toHaveFocus();

    rerender(<FocusHandoffHarness isCompactViewport={false} showFocusedDetail={false} />);

    expect(screen.getByRole("button", { name: "Build release" })).toHaveFocus();
  });

  it("preserves the current card across desktop to compact list replacement", () => {
    const { rerender } = render(
      <FocusHandoffHarness isCompactViewport={false} showFocusedDetail={false} />
    );

    screen.getByRole("button", { name: "Review patch" }).focus();
    rerender(<FocusHandoffHarness isCompactViewport showFocusedDetail={false} />);

    expect(screen.getByRole("button", { name: "Review patch" })).toHaveFocus();
  });
});
