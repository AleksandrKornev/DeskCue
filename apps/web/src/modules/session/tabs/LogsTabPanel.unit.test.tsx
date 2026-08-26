import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

import { LogsTabPanel } from "./LogsTabPanel";
import type { LogsTabPanelProps } from "./types";

function renderLogsTabPanel() {
  const props: LogsTabPanelProps = {
    actionRequest: null,
    activePromptText: null,
    canSendInput: true,
    debugEntries: [],
    draftScopeKey: "session:generic-test",
    hasSelectedSession: true,
    hasSourceSession: false,
    inputUnavailableLabel: null,
    isInterruptingPrompt: false,
    isPromptInFlight: false,
    isPromptQueued: false,
    liveUpdatesConnection: { lastSyncedAt: null, status: "live" },
    onInterruptPrompt: vi.fn(),
    onSendInput: vi.fn(() => Promise.resolve(true)),
    sharedSessionHint: null,
    viewerCount: 1
  };

  render(<LogsTabPanel {...props} />);
}

describe("LogsTabPanel", () => {
  afterEach(() => {
    resetDeskCueRuntimeForTests();
    window.history.replaceState({}, "", "/");
  });

  it("does not render an unreachable command-input panel without Cloud session control", () => {
    window.history.replaceState({}, "", "/machines/machine-01/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));

    renderLogsTabPanel();

    expect(screen.queryByRole("heading", { name: "Send message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Review only" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps the writable manual command surface locally", () => {
    renderLogsTabPanel();

    expect(screen.getByRole("heading", { name: "Send message" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("continue, explain, fix, or approve")).toBeEnabled();
  });
});
