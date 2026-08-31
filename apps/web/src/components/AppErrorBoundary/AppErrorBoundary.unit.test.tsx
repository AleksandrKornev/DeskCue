import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "./AppErrorBoundary";

function BrokenView(): never {
  throw new Error("incompatible payload");
}

describe("AppErrorBoundary", () => {
  it("renders a recoverable page instead of leaving a blank screen", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <AppErrorBoundary>
        <BrokenView />
      </AppErrorBoundary>
    );

    expect(screen.getByRole("alert")).toHaveAccessibleName("Reload this page to try again");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Reload this page to try again"
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reloading refreshes only this page. It doesn't send a stop command to your agents."
    );

    expect(screen.getByRole("button", { name: "Reload DeskCue" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("alert"));
    consoleError.mockRestore();
  });

  it("does not nest a main landmark when DeskCue is embedded", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <main>
        <AppErrorBoundary embedded>
          <BrokenView />
        </AppErrorBoundary>
      </main>
    );

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveAccessibleName("Reload this page to try again");
    consoleError.mockRestore();
  });
});
