import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionSummary } from "@deskcue/protocol";
import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

import { ManualSessionChrome } from "./ManualSessionChrome";
import styles from "./styles.module.scss";
import type { ManualSessionChromeProps } from "./types";

function createRunningSession(command = "npm test", id = "manual-1") {
  return {
    adapterId: "generic",
    command,
    id,
    sourceSessionId: null,
    status: "running"
  } as unknown as SessionSummary;
}

function renderChrome(
  activeTab: ManualSessionChromeProps["activeTab"] = "overview",
  sessionShell = createRunningSession()
) {
  const onStopSession = vi.fn();

  const view = render(
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
      sessionShell={sessionShell}
      takenOverAgentSession={null}
    />
  );

  return { onStopSession, ...view };
}

describe("ManualSessionChrome", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetDeskCueRuntimeForTests();
    window.history.replaceState({}, "", "/");
  });

  it("does not expose Generic CLI Stop without Cloud session control", () => {
    window.history.replaceState({}, "", "/machines/machine-01/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));
    const { onStopSession } = renderChrome();

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

  it("keeps a long command bounded behind an explicit disclosure", () => {
    const command = `node -e "run" ${"x".repeat(10_000)}`;

    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);

    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);

    renderChrome("overview", createRunningSession(command));

    const commandText = screen.getByText(command);
    const disclosure = screen.getByRole("button", { name: "Show full command" });

    expect(commandText).toHaveClass(styles.sessionHeaderCommandCollapsible);

    expect(commandText).not.toHaveClass(styles.sessionHeaderCommandExpanded);
    expect(commandText).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(/^Command preview:/u).textContent?.length).toBeLessThan(200);
    expect(disclosure).toHaveAttribute("aria-controls", commandText.id);
    expect(disclosure).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(disclosure);

    expect(commandText).toHaveClass(styles.sessionHeaderCommandExpanded);
    expect(commandText).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("button", { name: "Collapse command" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("does not add disclosure noise to a short command", () => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(24);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(24);

    renderChrome();

    expect(screen.getByText("npm test")).not.toHaveAttribute("aria-hidden");
    expect(screen.queryByRole("button", { name: "Show full command" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Command preview:/u)).not.toBeInTheDocument();
  });

  it("keeps the full fitting command available to assistive technology", () => {
    const command = "i".repeat(200);

    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);

    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(60);

    renderChrome("overview", createRunningSession(command));

    expect(screen.getByText(command)).not.toHaveAttribute("aria-hidden");
    expect(screen.queryByRole("button", { name: "Show full command" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Command preview:/u)).not.toBeInTheDocument();
  });

  it.each([
    ["an exact 240-character command", "x".repeat(240)],
    ["a short multiline command", "one\ntwo\nthree\nfour"]
  ])("uses rendered overflow rather than length for %s", (_caseName, command) => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(61);

    renderChrome("overview", createRunningSession(command));

    expect(screen.getByRole("button", { name: "Show full command" })).toBeInTheDocument();
  });

  it("collapses an expanded command synchronously when the session changes", () => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);
    const firstCommand = "first\n".repeat(100);
    const secondCommand = "second\n".repeat(100);
    const { rerender } = renderChrome("overview", createRunningSession(firstCommand, "manual-1"));
    const firstCommandText = document.getElementById("manual-test-command");

    fireEvent.click(screen.getByRole("button", { name: "Show full command" }));
    expect(firstCommandText).toHaveClass(styles.sessionHeaderCommandExpanded);

    rerender(
      <ManualSessionChrome
        activeSelectedSession={null}
        activeTab="overview"
        navigationCapabilities={{
          changes: false,
          conversation: false,
          files: false,
          output: true,
          preview: false
        }}
        navigationIdPrefix="manual-session"
        onExitSession={vi.fn()}
        onSelectTab={vi.fn()}
        onStopSession={vi.fn()}
        sessionShell={createRunningSession(secondCommand, "manual-2")}
        takenOverAgentSession={null}
      />
    );

    const secondCommandText = document.getElementById("manual-session-command");

    expect(secondCommandText?.textContent).toBe(secondCommand);

    expect(secondCommandText).not.toHaveClass(styles.sessionHeaderCommandExpanded);
    expect(secondCommandText).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Show full command" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    rerender(
      <ManualSessionChrome
        activeSelectedSession={null}
        activeTab="overview"
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
        onStopSession={vi.fn()}
        sessionShell={createRunningSession(firstCommand, "manual-1")}
        takenOverAgentSession={null}
      />
    );

    const returnedFirstCommandText = document.getElementById("manual-test-command");

    expect(returnedFirstCommandText).not.toHaveClass(styles.sessionHeaderCommandExpanded);

    expect(returnedFirstCommandText).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Show full command" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
});
