import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LiveSessionActions } from "./LiveSessionActions";

vi.mock("@assets/images/icon-more-horizontal.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));

describe("LiveSessionActions", () => {
  it("opens source-session diagnostics from the secondary menu", () => {
    const onOpenDiagnostics = vi.fn();

    render(
      <LiveSessionActions
        adapterLabel="Codex"
        sessionStatus="done"
        showTools={false}
        onExitSession={vi.fn()}
        onOpenDiagnostics={onOpenDiagnostics}
        onStopSession={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menu", { name: "More actions" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Diagnostics" }));

    expect(onOpenDiagnostics).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("moves focus into the menu and supports arrow, boundary, and Escape navigation", () => {
    render(
      <LiveSessionActions
        adapterLabel="Codex"
        compact
        sessionStatus="done"
        showTools={false}
        onExitSession={vi.fn()}
        onOpenDiagnostics={vi.fn()}
        onStopSession={vi.fn()}
        onToggleModelContext={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", { name: "More actions" });

    fireEvent.click(trigger);

    const firstItem = screen.getByRole("menuitem", { name: "Back to chats" });
    const lastItem = screen.getByRole("menuitem", { name: "Diagnostics" });

    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(firstItem).toHaveFocus();

    fireEvent.keyDown(firstItem, { key: "ArrowUp" });
    expect(lastItem).toHaveFocus();

    fireEvent.keyDown(lastItem, { key: "Home" });
    expect(firstItem).toHaveFocus();

    fireEvent.keyDown(firstItem, { key: "End" });
    expect(lastItem).toHaveFocus();

    fireEvent.keyDown(lastItem, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens from arrow keys at the requested menu boundary", () => {
    render(
      <LiveSessionActions
        adapterLabel="Codex"
        compact
        sessionStatus="done"
        showTools={false}
        onExitSession={vi.fn()}
        onOpenDiagnostics={vi.fn()}
        onStopSession={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", { name: "More actions" });

    fireEvent.keyDown(trigger, { key: "ArrowUp" });

    expect(screen.getByRole("menuitem", { name: "Diagnostics" })).toHaveFocus();
  });

  it("restores More actions focus after cancelling the Stop session dialog", () => {
    render(
      <LiveSessionActions
        adapterLabel="Codex"
        compact
        sessionStatus="running"
        showTools={false}
        onExitSession={vi.fn()}
        onStopSession={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", { name: "More actions" });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop session" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("repairs focus when a responsive menu item disappears while open", () => {
    const props = {
      adapterLabel: "Codex",
      sessionStatus: "done" as const,
      showTools: false,
      onExitSession: vi.fn(),
      onOpenDiagnostics: vi.fn(),
      onStopSession: vi.fn()
    };

    const { rerender } = render(<LiveSessionActions {...props} compact />);

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Back to chats" })).toHaveFocus();

    rerender(<LiveSessionActions {...props} compact={false} />);

    expect(screen.getByRole("menuitem", { name: "Diagnostics" })).toHaveFocus();
  });

  it("repairs focus when a dynamic menu item becomes disabled", () => {
    const props = {
      adapterLabel: "Codex",
      sessionStatus: "done" as const,
      showTools: false,
      onExitSession: vi.fn(),
      onOpenDiagnostics: vi.fn(),
      onStopSession: vi.fn()
    };

    const { rerender } = render(
      <LiveSessionActions
        {...props}
        extraMenuItem={<button role="menuitem" type="button">Dynamic action</button>}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Diagnostics" }), { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Dynamic action" })).toHaveFocus();

    rerender(
      <LiveSessionActions
        {...props}
        extraMenuItem={<button disabled role="menuitem" type="button">Dynamic action</button>}
      />
    );

    expect(screen.getByRole("menuitem", { name: "Diagnostics" })).toHaveFocus();
  });
});
