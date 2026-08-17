import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LiveConnectionIndicator } from "./LiveConnectionIndicator";

describe("LiveConnectionIndicator", () => {
  it("renders live status with a recent update age", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-07-17T10:00:05.000Z").getTime());

    render(
      <LiveConnectionIndicator
        connection={{
          lastSyncedAt: "2026-07-17T10:00:00.000Z",
          status: "live"
        }}
      />
    );

    const indicator = screen.getByRole("button", {
      name: "Live updated now; Live updated"
    });
    expect(indicator).toHaveAttribute(
      "aria-label",
      "Live updated now; Live updated"
    );
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getAllByText("updated")).not.toHaveLength(0);
  });

  it("renders connecting status when no sync has landed yet", () => {
    render(
      <LiveConnectionIndicator
        connection={{
          lastSyncedAt: null,
          status: "connecting"
        }}
      />
    );

    expect(screen.getByText("Connecting")).toBeInTheDocument();
    expect(screen.getByText("opening")).toBeInTheDocument();
  });
});
