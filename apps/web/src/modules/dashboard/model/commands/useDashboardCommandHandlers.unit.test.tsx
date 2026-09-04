import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import type { OverviewResponse } from "@deskcue/protocol";

import type { UseDashboardCommandHandlersArgs } from "./types";
import { useDashboardCommandHandlers } from "./useDashboardCommandHandlers";

type CommandHandlers = ReturnType<typeof useDashboardCommandHandlers>;

type TestHarnessProps = {
  args: UseDashboardCommandHandlersArgs;
  handlersRef: MutableRefObject<CommandHandlers | null>;
  startResultRef: MutableRefObject<Promise<void> | null>;
};

function createOverview(): OverviewResponse {
  return {
    clientContext: { canOpenNativeDialogs: true },
    sessions: [],
    workspaces: []
  };
}

function createArgs(): UseDashboardCommandHandlersArgs {
  const overview = createOverview();

  return {
    overview,
    selectedWorkspaceId: "",
    command: "codex",
    selectedAgentSessionId: "",
    selectedAgentSessionIdRef: { current: "" },
    agentAttachOperationRef: { current: { epoch: 0, targetSessionId: "" } },
    selectedSessionId: "",
    selectedSession: null,
    selectedSessionIdRef: { current: "" },
    selectedSessionSelectionEpochRef: { current: 0 },
    selectedSessionRef: { current: null },
    promptOperationRef: { current: { epoch: 0, targetSessionId: "" } },
    previewPort: "",
    setPreviewPort: vi.fn(),
    promptDelivery: {
      beginPromptDelivery: vi.fn(),
      markPromptAccepted: vi.fn(),
      clearPromptDeliveryState: vi.fn(),
      interruptPromptBeforeSendingReplacement: vi.fn().mockResolvedValue(true),
      setIsInterruptingPrompt: vi.fn()
    },
    updateOverview: vi.fn(),
    setSelectedWorkspaceId: vi.fn(),
    setSelectedSessionId: vi.fn(),
    setSelectedSession: vi.fn(),
    setActiveTab: vi.fn(),
    setError: vi.fn(),
    setLoading: vi.fn(),
    setAttachingAgentSessionId: vi.fn(),
    loadOverview: vi.fn().mockResolvedValue(overview),
    loadAgentSessions: vi.fn().mockResolvedValue([]),
    loadSession: vi.fn().mockResolvedValue(null)
  };
}

function readHandlers(handlersRef: MutableRefObject<CommandHandlers | null>) {
  if (!handlersRef.current) throw new Error("Command handlers were not captured");

  return handlersRef.current;
}

function TestHarness({ args, handlersRef, startResultRef }: TestHarnessProps) {
  const handlers = useDashboardCommandHandlers(args);

  handlersRef.current = handlers;

  return (
    <form
      aria-label="Manual command"
      onSubmit={(event) => {
        startResultRef.current = handlers.handleStartSession(event);
      }}
    >
      <button type="submit">Start</button>
    </form>
  );
}

describe("useDashboardCommandHandlers adapters", () => {
  it("forwards the submit event and preserves attach and stop Promise results", async () => {
    const args = createArgs();
    const handlersRef: MutableRefObject<CommandHandlers | null> = { current: null };
    const startResultRef: MutableRefObject<Promise<void> | null> = { current: null };

    render(
      <TestHarness
        args={args}
        handlersRef={handlersRef}
        startResultRef={startResultRef}
      />
    );

    fireEvent.submit(screen.getByRole("form", { name: "Manual command" }));

    expect(startResultRef.current).toBeInstanceOf(Promise);
    await expect(startResultRef.current).resolves.toBeUndefined();
    await waitFor(() => expect(args.setError).toHaveBeenCalledWith("Add or select a workspace first"));

    const handlers = readHandlers(handlersRef);
    const attachResult = handlers.handleAttachAgentSession();
    const stopResult = handlers.handleStopSession();

    expect(attachResult).toBeInstanceOf(Promise);
    expect(stopResult).toBeInstanceOf(Promise);
    await expect(attachResult).resolves.toBeNull();
    await expect(stopResult).resolves.toBe(false);
  });
});
