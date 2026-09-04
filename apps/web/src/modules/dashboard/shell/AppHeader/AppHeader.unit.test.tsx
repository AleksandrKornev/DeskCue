import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCloudMachineDeskCueRuntime,
  createLocalDeskCueRuntime,
  DeskCueRuntimeProvider,
  resetDeskCueRuntimeForTests
} from "@runtime";

import { AppHeader } from "./AppHeader";

vi.mock("@components/DeskCueWordmark", () => ({
  DeskCueWordmark: () => <span>DeskCue</span>
}));

vi.mock("./HeaderMetric", () => ({
  HeaderMetric: ({ label }: { label: string }) => <span>{label}</span>
}));

describe("AppHeader host boundary", () => {
  afterEach(() => {
    resetDeskCueRuntimeForTests();
    window.history.replaceState({}, "", "/");
  });

  it("does not render host navigation for a remote runtime", () => {
    window.history.replaceState({}, "", "/machines/machine-01/deskcue/");
    const runtime = createCloudMachineDeskCueRuntime(window.location);

    render(
      <MemoryRouter>
        <DeskCueRuntimeProvider runtime={runtime}>
          <AppHeader
            discoveredCount="12"
            managedCount={3}
            runningChatCount={1}
            isBootstrapping={false}
          />
        </DeskCueRuntimeProvider>
      </MemoryRouter>
    );

    expect(screen.queryByRole("navigation", { name: /cloud/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /security|machine/i }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Remote agent review" }))
      .toBeInTheDocument();
  });

  it("does not expose a no-op dashboard return control at the clean home route", () => {
    const onGoHome = vi.fn();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <DeskCueRuntimeProvider runtime={createLocalDeskCueRuntime()}>
          <AppHeader
            discoveredCount="12"
            managedCount={3}
            runningChatCount={1}
            isBootstrapping={false}
            onGoHome={onGoHome}
          />
        </DeskCueRuntimeProvider>
      </MemoryRouter>
    );

    expect(screen.queryByRole("button", { name: "Back to DeskCue dashboard" }))
      .not.toBeInTheDocument();
    expect(onGoHome).not.toHaveBeenCalled();
  });

  it("keeps dashboard return available when route state is encoded in the URL", () => {
    const onGoHome = vi.fn();

    render(
      <MemoryRouter initialEntries={["/?agent=source-01"]}>
        <DeskCueRuntimeProvider runtime={createLocalDeskCueRuntime()}>
          <AppHeader
            discoveredCount="12"
            managedCount={3}
            runningChatCount={1}
            isBootstrapping={false}
            onGoHome={onGoHome}
          />
        </DeskCueRuntimeProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to DeskCue dashboard" }));

    expect(onGoHome).toHaveBeenCalledTimes(1);
  });
});
