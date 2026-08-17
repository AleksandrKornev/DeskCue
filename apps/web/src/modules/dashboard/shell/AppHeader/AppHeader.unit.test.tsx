import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCloudMachineDeskCueRuntime,
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
    expect(screen.getByRole("heading", { name: "Review your remote agent chats" }))
      .toBeInTheDocument();
  });
});
