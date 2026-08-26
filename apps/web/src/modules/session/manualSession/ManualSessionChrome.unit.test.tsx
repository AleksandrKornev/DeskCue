import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionSummary } from "@deskcue/protocol";
import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

import { ManualSessionChrome } from "./ManualSessionChrome";
import type { ManualSessionChromeProps } from "./types";

function createRunningSession() {
  return {
    adapterId: "generic",
    command: "npm test",
    sourceSessionId: null,
    status: "running"
  } as unknown as SessionSummary;
}

function renderChrome(activeTab: ManualSessionChromeProps["activeTab"] = "overview") {
  const onStopSession = vi.fn();

  render(
    <ManualSessionChrome
      activeSelectedSession={null}
      activeTab={activeTab}
      navigationCapabilities={{
        changes: false,
        conversation: false,
        files: false,
        output: true,
        preview: false
      }}
      navigationIdPrefix="manual-test"
      onExitSession={vi.fn()}
      onSelectTab={vi.fn()}
      onStopSession={onStopSession}
      sessionShell={createRunningSession()}
      takenOverAgentSession={null}
    />
  );

  return onStopSession;
}

describe("ManualSessionChrome", () => {
  afterEach(() => {
    resetDeskCueRuntimeForTests();
    window.history.replaceState({}, "", "/");
  });

  it("does not expose Generic CLI Stop without Cloud session control", () => {
    window.history.replaceState({}, "", "/machines/machine-01/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));
    const onStopSession = renderChrome();

    expect(screen.getByText("Manual command")).toBeInTheDocument();
    expect(screen.getByText(
      "Control is not shared by this machine. Enable it locally in DeskCue Settings → Access → Cloud."
    )).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(onStopSession).not.toHaveBeenCalled();
  });

  it("keeps the missing-Control reason visible in the header on Output", () => {
    window.history.replaceState({}, "", "/machines/machine-01/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));

    renderChrome("logs");

    expect(screen.getByText(
      "Control is not shared by this machine. Enable it locally in DeskCue Settings → Access → Cloud."
    )).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });
});
