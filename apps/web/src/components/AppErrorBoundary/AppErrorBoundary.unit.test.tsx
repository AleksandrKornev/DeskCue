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

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something changed while this page was open"
    );
    expect(screen.getByRole("button", { name: "Reload DeskCue" })).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
