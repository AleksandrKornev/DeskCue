import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

import { SessionMessageComposer } from "./SessionMessageComposer";
import type { SessionMessageComposerProps } from "./types";

function renderComposer(overrides: Partial<SessionMessageComposerProps> = {}) {
  const props: SessionMessageComposerProps = {
    canSendInput: true,
    draftScopeKey: "session:test",
    isInterruptingPrompt: false,
    isPromptInFlight: false,
    mode: "chat",
    onInterruptPrompt: vi.fn(),
    onSendInput: vi.fn(() => Promise.resolve(true)),
    ...overrides
  };

  render(<SessionMessageComposer {...props} />);

  return props;
}

describe("SessionMessageComposer", () => {
  it("does not expose remote commands when the Cloud transport is read only", () => {
    window.history.replaceState({}, "", "/machines/machine-01/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));
    const onSendInput = vi.fn(() => Promise.resolve(true));

    try {
      renderComposer({ onSendInput });

      expect(screen.getByRole("textbox", { name: "Remote session is read only" }))
        .toBeDisabled();
      expect(screen.queryByRole("button", { name: "Send message" }))
        .not.toBeInTheDocument();
      expect(onSendInput).not.toHaveBeenCalled();
    } finally {
      resetDeskCueRuntimeForTests();
      window.history.replaceState({}, "", "/");
    }
  });

  it("disables input and send button for read-only sessions", () => {
    renderComposer({ canSendInput: false });

    expect(screen.getByRole("textbox", { name: "Next message" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(screen.getByPlaceholderText("This session is read only")).toBeInTheDocument();
  });

  it("sends a trimmed draft", async () => {
    const onSendInput = vi.fn(() => Promise.resolve(true));
    renderComposer({ onSendInput });

    fireEvent.change(screen.getByRole("textbox", { name: "Next message" }), {
      target: { value: "  continue please  " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(onSendInput).toHaveBeenCalledWith("continue please", {
        actionDecision: undefined,
        replaceRunningPrompt: false
      });
    });
  });

  it("submits a single-line draft with Enter", async () => {
    const onSendInput = vi.fn(() => Promise.resolve(true));
    renderComposer({ onSendInput });
    const field = screen.getByRole("textbox", { name: "Next message" });

    fireEvent.change(field, { target: { value: "send this" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => {
      expect(onSendInput).toHaveBeenCalledWith("send this", {
        actionDecision: undefined,
        replaceRunningPrompt: false
      });
    });
  });

  it("keeps Enter as a newline action in the compact mobile layout", () => {
    const onSendInput = vi.fn(() => Promise.resolve(true));
    renderComposer({ compactViewport: true, onSendInput });
    const field = screen.getByRole("textbox", { name: "Next message" });

    fireEvent.change(field, { target: { value: "send this" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onSendInput).not.toHaveBeenCalled();
  });

  it("keeps Ctrl+Enter as a newline action in the compact mobile layout", () => {
    const onSendInput = vi.fn(() => Promise.resolve(true));
    renderComposer({ compactViewport: true, onSendInput });
    const field = screen.getByRole("textbox", { name: "Next message" });

    fireEvent.change(field, { target: { value: "send this" } });
    fireEvent.keyDown(field, { ctrlKey: true, key: "Enter" });

    expect(onSendInput).not.toHaveBeenCalled();
  });

  it("keeps plain Enter for a draft that is already multiline", () => {
    const onSendInput = vi.fn(() => Promise.resolve(true));
    renderComposer({ onSendInput });
    const field = screen.getByRole("textbox", { name: "Next message" });

    fireEvent.change(field, { target: { value: "first line\nsecond line" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onSendInput).not.toHaveBeenCalled();
  });

  it("submits a multiline draft with Ctrl+Enter", async () => {
    const onSendInput = vi.fn(() => Promise.resolve(true));
    renderComposer({ onSendInput });
    const field = screen.getByRole("textbox", { name: "Next message" });

    fireEvent.change(field, { target: { value: "first line\nsecond line" } });
    fireEvent.keyDown(field, { ctrlKey: true, key: "Enter" });

    await waitFor(() => {
      expect(onSendInput).toHaveBeenCalledWith("first line\nsecond line", {
        actionDecision: undefined,
        replaceRunningPrompt: false
      });
    });
  });

  it("keeps Shift+Enter as a newline shortcut", () => {
    const onSendInput = vi.fn(() => Promise.resolve(true));
    renderComposer({ onSendInput });
    const field = screen.getByRole("textbox", { name: "Next message" });

    fireEvent.change(field, { target: { value: "single line" } });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });

    expect(onSendInput).not.toHaveBeenCalled();
  });

  it("interrupts an in-flight prompt when no replacement draft exists", () => {
    const onInterruptPrompt = vi.fn();
    renderComposer({
      isPromptInFlight: true,
      onInterruptPrompt
    });

    fireEvent.click(screen.getByRole("button", { name: "Interrupt prompt" }));

    expect(onInterruptPrompt).toHaveBeenCalledOnce();
  });

  it("sends approval decisions through the composer action path", async () => {
    const onSendInput = vi.fn(() => Promise.resolve(true));
    renderComposer({
      actionRequest: {
        command: "apply patch",
        kind: "approval",
        reason: "Agent wants to edit files",
        requestedAt: "2026-07-17T10:00:00.000Z"
      },
      onSendInput
    });

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(onSendInput).toHaveBeenCalledWith("y", {
        actionDecision: "approve"
      });
    });
  });
});
