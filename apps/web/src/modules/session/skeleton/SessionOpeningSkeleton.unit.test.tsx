import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("uses the caller-provided loading label", () => {
    render(<SessionOpeningSkeleton loadingLabel="Loading local chat" />);

    expect(screen.getByRole("status", { name: "Loading local chat" })).toBeInTheDocument();
  });

  it("keeps retry available without rendering loading geometry", () => {
    const retry = vi.fn(async () => {});
    const { container } = render(
      <SessionOpeningSkeleton errorMessage="Temporary read failure" onRetry={retry} />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Temporary read failure");
    expect(screen.getByRole("heading", {
      level: 1,
      name: "Session unavailable"
    })).toBeInTheDocument();
    expect(container.querySelector('[data-loading-region="transcript"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("restores focus to Retry when the repeated load fails", async () => {
    const retry = vi.fn(async () => {});
    const view = render(
      <SessionOpeningSkeleton errorMessage="First read failure" onRetry={retry} />
    );
    const retryButton = screen.getByRole("button", { name: "Retry" });

    retryButton.focus();
    fireEvent.click(retryButton);
    view.rerender(<SessionOpeningSkeleton errorMessage={null} onRetry={retry} />);
    view.rerender(
      <SessionOpeningSkeleton errorMessage="Second read failure" onRetry={retry} />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();
    });
  });

  it("retains the error surface and blocks duplicate retries while pending", async () => {
    let resolveRetry: (() => void) | undefined;
    const retry = vi.fn(() => new Promise<void>((resolve) => {
      resolveRetry = resolve;
    }));

    render(<SessionOpeningSkeleton errorMessage="Temporary read failure" onRetry={retry} />);

    const retryButton = screen.getByRole("button", { name: "Retry" });

    retryButton.focus();
    fireEvent.click(retryButton);

    expect(screen.getByRole("alert")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Retrying…" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Retrying…" }));
    expect(retry).toHaveBeenCalledTimes(1);

    resolveRetry?.();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();
    });
  });

  it("does not transfer a pending Retry focus to another session", () => {
    const retry = vi.fn(async () => {});
    const view = render(
      <SessionOpeningSkeleton
        key="session-a"
        errorMessage="Session A read failure"
        onRetry={retry}
      />
    );
    const retryButton = screen.getByRole("button", { name: "Retry" });

    retryButton.focus();
    fireEvent.click(retryButton);
    view.rerender(
      <SessionOpeningSkeleton
        key="session-b"
        errorMessage="Session B read failure"
        onRetry={retry}
      />
    );

    expect(screen.getByRole("button", { name: "Retry" })).not.toHaveFocus();
  });
});
