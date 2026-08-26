import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccessRequiredPage } from "./AccessRequiredPage";

const mocks = vi.hoisted(() => ({
  connectionPreparationFailure: null as { message: string; title: string } | null
}));

vi.mock("@api/connection", () => ({
  buildCurrentDaemonAccessSettingsUrl: () =>
    "http://deskcue.test:4310/settings?tab=access"
}));

vi.mock("@api/connection/pairing", () => ({
  clearConnectionPreparationFailure: vi.fn(),
  readConnectionPreparationFailure: () => mocks.connectionPreparationFailure
}));

vi.mock("@components/DeskCueWordmark", () => ({
  DeskCueWordmark: () => <span aria-hidden="true">DeskCue</span>
}));

describe("AccessRequiredPage", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.connectionPreparationFailure = null;
  });

  it("explains origin-scoped pairing without promoting a specific network product", () => {
    render(
      <MemoryRouter>
        <AccessRequiredPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/different address is treated as a separate client/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/tailscale/i)).not.toBeInTheDocument();
  });

  it("uses the current daemon address and keeps Retry before the instructions", () => {
    render(
      <MemoryRouter>
        <AccessRequiredPage />
      </MemoryRouter>
    );

    expect(screen.getByText("http://deskcue.test:4310/settings?tab=access"))
      .toBeInTheDocument();
    expect(screen.queryByText(/127\.0\.0\.1:4100/)).not.toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: "Retry" });
    const firstStep = screen.getByText(/On the host computer, open/i);
    expect(retryButton.compareDocumentPosition(firstStep) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it("announces the latest pairing failure with a fresh-link action", () => {
    mocks.connectionPreparationFailure = {
      message: "This pairing link is invalid, expired, or already used. Create a fresh device link.",
      title: "Pairing link did not work"
    };

    render(
      <MemoryRouter>
        <AccessRequiredPage />
      </MemoryRouter>
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Pairing link did not work");
    expect(alert).toHaveTextContent(/invalid, expired, or already used/i);
    expect(alert).toHaveTextContent(/fresh device link/i);
  });
});
