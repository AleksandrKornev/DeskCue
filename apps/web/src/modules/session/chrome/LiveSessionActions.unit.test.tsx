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
    fireEvent.click(screen.getByRole("menuitem", { name: "Diagnostics" }));

    expect(onOpenDiagnostics).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
