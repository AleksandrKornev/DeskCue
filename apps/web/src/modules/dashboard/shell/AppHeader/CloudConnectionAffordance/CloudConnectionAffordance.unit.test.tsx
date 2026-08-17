import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@modules/cloudConnection/model/useCloudConnectionStatus", () => ({
  useCloudConnectionStatus: () => ({ status: null })
}));

import { CloudConnectionAffordance } from "./CloudConnectionAffordance";

describe("CloudConnectionAffordance", () => {
  it("shows local-only state and opens the Connections settings owner", () => {
    render(
      <MemoryRouter>
        <CloudConnectionAffordance />
      </MemoryRouter>
    );

    const link = screen.getByRole("link", {
      name: "DeskCue local only; open Connections settings"
    });

    expect(link).toHaveTextContent("Local only");
    expect(link).toHaveAttribute("href", "/settings?tab=access");
  });
});
