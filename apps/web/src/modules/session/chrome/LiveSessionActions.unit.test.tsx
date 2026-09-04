import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveSessionActions } from "./LiveSessionActions";

vi.mock("@assets/images/icon-more-horizontal.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));

function createMatchMediaController(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<EventListener>();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    addEventListener: vi.fn((_type: string, listener: EventListener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: EventListener) => listeners.delete(listener))
  } as unknown as MediaQueryList;

  return {
    matchMedia: vi.fn(() => mediaQuery),
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      listeners.forEach((listener) => listener(new Event("change")));
    }
  };
}

type MobileActionHandoff = "diagnostics" | "model" | "tools";

function MobileActionHandoffFixture({ action }: { action: MobileActionHandoff }) {
  const [destination, setDestination] = useState<MobileActionHandoff | null>(null);

  return (
    <>
      <LiveSessionActions
        adapterLabel="Codex"
        compact
        sessionStatus="done"
        showTools={false}
        onExitSession={vi.fn()}
        onOpenDiagnostics={() => setDestination("diagnostics")}
        onStopSession={vi.fn()}
        onToggleModelContext={() => setDestination("model")}
        onToggleTools={() => setDestination("tools")}
      />
      {destination === action ? <div role="status">Opened {destination}</div> : null}
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

    trigger.focus();
    fireEvent.click(trigger);

    const firstItem = screen.getByRole("menuitem", { name: "Model & runtime" });
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

  it("opens the mobile actions as a bottom-sheet dialog without duplicating Back", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController(true).matchMedia);

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

    trigger.focus();
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByRole("dialog", { name: "Session actions" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Back to chats" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Diagnostics" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Diagnostics" }), { key: "Tab" });
    expect(screen.getByRole("dialog", { name: "Session actions" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close session actions" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it.each([
    ["Model & runtime", "model"],
    ["Tools", "tools"],
    ["Diagnostics", "diagnostics"]
  ] as const)("hands off the mobile sheet to %s", (menuItem, action) => {
    vi.stubGlobal("matchMedia", createMatchMediaController(true).matchMedia);

    render(<MobileActionHandoffFixture action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: menuItem }));

    expect(screen.queryByRole("dialog", { name: "Session actions" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(`Opened ${action}`);
  });

  it("replaces the mobile sheet history entry when opening routed tools", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController(true).matchMedia);
    const onToggleTools = vi.fn();

    render(
      <LiveSessionActions
        adapterLabel="Codex"
        compact
        sessionStatus="done"
        showTools={false}
        onExitSession={vi.fn()}
        onStopSession={vi.fn()}
        onToggleTools={onToggleTools}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tools" }));

    expect(onToggleTools).toHaveBeenCalledWith({ replace: true });
  });

  it("keeps wide compact-height actions inside the single More slot", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      matches: query.includes("max-height: 640px"),
      media: query,
      removeEventListener: vi.fn()
    }) as unknown as MediaQueryList));

    render(
      <LiveSessionActions
        adapterLabel="Codex"
        sessionStatus="done"
        showTools={false}
        onExitSession={vi.fn()}
        onOpenDiagnostics={vi.fn()}
        onStopSession={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions" }))
      .toHaveAttribute("aria-haspopup", "menu");
  });

  it("moves focus to More when a focused desktop action is compacted", () => {
    const media = createMatchMediaController(false);

    vi.stubGlobal("matchMedia", media.matchMedia);

    render(
      <LiveSessionActions
        adapterLabel="Codex"
        sessionStatus="done"
        showTools={false}
        onExitSession={vi.fn()}
        onOpenDiagnostics={vi.fn()}
        onStopSession={vi.fn()}
      />
    );

    screen.getByRole("button", { name: "Back" }).focus();

    act(() => media.setMatches(true));

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions" })).toHaveFocus();
  });

  it("moves focus to More when a focused desktop Stop disappears after completion", () => {
    const props = {
      adapterLabel: "Codex",
      sessionStatus: "running" as const,
      showTools: false,
      onExitSession: vi.fn(),
      onOpenDiagnostics: vi.fn(),
      onStopSession: vi.fn()
    };

    const { rerender } = render(<LiveSessionActions {...props} />);

    screen.getByRole("button", { name: "Stop" }).focus();
    rerender(<LiveSessionActions {...props} sessionStatus="done" />);

    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions" })).toHaveFocus();
  });

  it("does not move focus after the desktop action released it before compaction", () => {
    const media = createMatchMediaController(false);

    vi.stubGlobal("matchMedia", media.matchMedia);

    render(
      <LiveSessionActions
        adapterLabel="Codex"
        sessionStatus="done"
        showTools={false}
        onExitSession={vi.fn()}
        onOpenDiagnostics={vi.fn()}
        onStopSession={vi.fn()}
      />
    );

    const back = screen.getByRole("button", { name: "Back" });

    back.focus();
    back.blur();

    act(() => media.setMatches(true));

    expect(screen.getByRole("button", { name: "More actions" })).not.toHaveFocus();
  });

  it("closes the action surface when its responsive presentation changes", () => {
    const media = createMatchMediaController(true);

    vi.stubGlobal("matchMedia", media.matchMedia);

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

    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Session actions" })).toBeInTheDocument();

    act(() => media.setMatches(false));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
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
