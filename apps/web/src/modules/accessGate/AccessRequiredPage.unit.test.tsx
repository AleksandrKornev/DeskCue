import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccessRequiredPage } from "./AccessRequiredPage";

vi.mock("@components/DeskCueWordmark", () => ({
  DeskCueWordmark: () => <span aria-hidden="true">DeskCue</span>
}));

describe("AccessRequiredPage", () => {
  beforeEach(() => {
    localStorage.clear();
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
});
