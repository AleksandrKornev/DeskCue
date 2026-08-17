import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionSkeleton } from "@modules/appShell/RouteLoadingShell/SessionSkeleton";
import { DashboardBootShell } from "@modules/dashboard/shell/DashboardBootShell";

import { SessionOpeningSkeleton } from "./SessionOpeningSkeleton";

describe.each([
  ["route loading", <SessionSkeleton key="route" />],
  ["dashboard bootstrap", <DashboardBootShell key="dashboard" />],
  ["session hydration", <SessionOpeningSkeleton key="session" />]
])("source-session loading geometry during %s", (_stage, element) => {
  it("reserves stable toolbar, transcript and composer regions", () => {
    const { container } = render(element);

    expect(screen.getByRole("status", { name: "Loading source-agent chat" })).toBeInTheDocument();
    expect(container.querySelector('[data-loading-region="toolbar"]')).not.toBeNull();
    expect(container.querySelector('[data-loading-region="transcript"]')).not.toBeNull();
    expect(container.querySelector('[data-loading-region="composer"]')).not.toBeNull();
  });
});

describe("SessionOpeningSkeleton error state", () => {
  it("keeps retry available without rendering loading geometry", () => {
    const retry = vi.fn(async () => {});
    const { container } = render(
      <SessionOpeningSkeleton errorMessage="Temporary read failure" onRetry={retry} />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Temporary read failure");
    expect(container.querySelector('[data-loading-region="transcript"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
