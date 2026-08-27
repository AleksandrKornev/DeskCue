import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

import { SessionMessageComposer } from "./SessionMessageComposer";
import type { SessionMessageComposerProps } from "./types";

const requestConfirmation = vi.hoisted(() => vi.fn());

vi.mock("@components/ModalDialog", () => ({ requestConfirmation }));

let composerSequence = 0;

function renderComposer(overrides: Partial<SessionMessageComposerProps> = {}) {
  const props: SessionMessageComposerProps = {
    canSendInput: true,
    draftScopeKey: `session:test:${composerSequence += 1}`,
    isInterruptingPrompt: false,
    isPromptInFlight: false,
    mode: "chat",
    onInterruptPrompt: vi.fn(),
    onSendInput: vi.fn(() => Promise.resolve(true)),
    ...overrides
  };

  const view = render(<SessionMessageComposer {...props} />);

  return { props, ...view };
}

describe("SessionMessageComposer", () => {
  beforeEach(() => {
    requestConfirmation.mockReset();
    requestConfirmation.mockResolvedValue(true);
  });

  it("does not expose remote commands when the Cloud transport is read only", () => {
    window.history.replaceState({}, "", "/machines/machine-01/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));
    const onSendInput = vi.fn(() => Promise.resolve(true));

    try {
      renderComposer({ onSendInput });

      expect(screen.getByRole("textbox", { name: "Review-only chat" }))
        .toBeDisabled();
      expect(screen.getByText(
        "Control is not shared by this machine. Enable it locally in DeskCue Settings → Connections → DeskCue Cloud."
      )).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Review only")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Send message" }))
        .not.toBeInTheDocument();
      expect(onSendInput).not.toHaveBeenCalled();
    } finally {
      resetDeskCueRuntimeForTests();
      window.history.replaceState({}, "", "/");
    }
  });

  it("owns the single missing-Control reason for read-only inline input", () => {
    window.history.replaceState({}, "", "/machines/machine-01/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));

    try {
      renderComposer({ mode: "inline" });

      expect(screen.getAllByText(
        "Control is not shared by this machine. Enable it locally in DeskCue Settings → Connections → DeskCue Cloud."
      )).toHaveLength(1);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
    } finally {
      resetDeskCueRuntimeForTests();
      window.history.replaceState({}, "", "/");
    }
  });

  it("explains why session input is unavailable", () => {
    renderComposer({
      canSendInput: false,
      inputUnavailableLabel: "Turn active outside DeskCue"
    });

    expect(screen.getByRole("textbox", { name: "Next message" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Input unavailable")).toBeInTheDocument();
    expect(screen.getAllByText("Turn active outside DeskCue")).toHaveLength(1);
  });

  it("normalizes and does not duplicate the same unavailable-input reason", () => {
    renderComposer({
      canSendInput: false,
      inputUnavailableLabel: "This session is not accepting input.",
      sharedSessionHint: "This session is not accepting input."
    });

    const field = screen.getByRole("textbox", { name: "Next message" });

    expect(field).toHaveAttribute("placeholder", "Input unavailable");
    expect(field).not.toHaveAttribute("title");
    expect(screen.queryByText("This session is not accepting input.")).not.toBeInTheDocument();
    expect(screen.getAllByText("This session is not accepting input")).toHaveLength(1);
  });

  it("does not repeat a disabled-input reason as a second visible hint", () => {
    renderComposer({
      canSendInput: false,
      inputUnavailableLabel: "Turn active outside DeskCue",
      sharedSessionHint: "This turn is running outside DeskCue. Finish or stop it in the controlling client"
    });

    expect(screen.getByPlaceholderText("Input unavailable")).toBeInTheDocument();
    expect(screen.getAllByText("Turn active outside DeskCue")).toHaveLength(1);
    expect(screen.queryByText(/This turn is running outside DeskCue/u)).not.toBeInTheDocument();
  });

  it("keeps the persistent input blocker when transport is also unavailable", () => {
    renderComposer({
      canSendInput: false,
      inputUnavailableLabel: "Another Codex client still owns this chat. Close it there, then retry.",
      liveUpdatesConnection: { lastSyncedAt: null, status: "offline" }
    });

    expect(screen.getByPlaceholderText("Input unavailable")).toBeInTheDocument();
    expect(screen.getAllByText(
      "Another Codex client still owns this chat. Close it there, then retry"
    )).toHaveLength(1);
    expect(screen.queryByText(/sending will be available after reconnecting/u)).not.toBeInTheDocument();
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

  it("keeps a draft visible but blocks sending until live updates reconnect", () => {
    const draftScopeKey = "session:offline-draft";
    const onSendInput = vi.fn(() => Promise.resolve(true));
    const firstView = renderComposer({
      draftScopeKey,
      liveUpdatesConnection: { lastSyncedAt: "2026-08-26T10:00:00.000Z", status: "live" },
      onSendInput
    });
    const liveField = screen.getByRole("textbox", { name: "Next message" });

    fireEvent.change(liveField, { target: { value: "keep this reconnect draft" } });

    firstView.rerender(
      <SessionMessageComposer
        {...firstView.props}
        liveUpdatesConnection={{ lastSyncedAt: "2026-08-26T10:00:00.000Z", status: "offline" }}
      />
    );

    expect(screen.getByRole("textbox", { name: "Next message" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Next message" }))
      .toHaveValue("keep this reconnect draft");
    expect(screen.getByRole("textbox", { name: "Next message" }))
      .toHaveAttribute(
        "placeholder",
        "Waiting for connection"
      );
    expect(screen.getByText(/Offline — your draft is saved/u)).toBeInTheDocument();

    firstView.unmount();

    const reconnectView = renderComposer({
      draftScopeKey,
      liveUpdatesConnection: { lastSyncedAt: "2026-08-26T10:00:00.000Z", status: "reconnecting" },
      onSendInput
    });
    const reconnectingField = screen.getByRole("textbox", { name: "Next message" });

    expect(reconnectingField).toBeDisabled();
    expect(reconnectingField).toHaveValue("keep this reconnect draft");
    expect(reconnectingField).toHaveAttribute(
      "placeholder",
      "Waiting for connection"
    );
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(screen.getByText(/Reconnecting — your draft is saved/u)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSendInput).not.toHaveBeenCalled();

    reconnectView.rerender(
      <SessionMessageComposer
        {...reconnectView.props}
        liveUpdatesConnection={{ lastSyncedAt: "2026-08-26T10:00:05.000Z", status: "live" }}
      />
    );

    expect(screen.getByRole("textbox", { name: "Next message" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Next message" }))
      .toHaveValue("keep this reconnect draft");
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("uses one accurate transport reason when no draft is saved", () => {
    const offlineConnection = { lastSyncedAt: null, status: "offline" } as const;

    renderComposer({
      liveUpdatesConnection: offlineConnection,
      sharedSessionHint: "Two clients are watching this turn"
    });

    const field = screen.getByRole("textbox", { name: "Next message" });

    expect(field).toBeDisabled();
    expect(field).toHaveAttribute("placeholder", "Waiting for connection");
    expect(field).not.toHaveAttribute("title");
    expect(screen.getAllByText("Offline — sending will be available after reconnecting."))
      .toHaveLength(1);
    expect(screen.queryByText(/your draft is saved/u)).not.toBeInTheDocument();
    expect(screen.queryByText("Two clients are watching this turn")).not.toBeInTheDocument();
  });

  it("keeps inline transport state concise without repeating the detailed reason", () => {
    renderComposer({
      liveUpdatesConnection: { lastSyncedAt: null, status: "connecting" },
      mode: "inline"
    });

    const field = screen.getByRole("textbox", { name: "Next message" });

    expect(field).toBeDisabled();
    expect(field).toHaveAttribute("name", "session-message");
    expect(field).toHaveAttribute("placeholder", "Waiting for connection");
    expect(screen.getAllByText(
      "Connecting to DeskCue — sending will be available when live updates start."
    )).toHaveLength(1);
  });

  it("clears the cached draft only after the send is accepted", async () => {
    const draftScopeKey = "session:accepted-draft";
    const onSendInput = vi.fn(() => Promise.resolve(true));
    const firstView = renderComposer({ draftScopeKey, onSendInput });

    fireEvent.change(screen.getByRole("textbox", { name: "Next message" }), {
      target: { value: "accepted once" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onSendInput).toHaveBeenCalledOnce());

    firstView.unmount();
    renderComposer({ draftScopeKey, onSendInput });

    expect(screen.getByRole("textbox", { name: "Next message" })).toHaveValue("");
  });

  it("blocks approval and interrupt actions while offline", () => {
    const onInterruptPrompt = vi.fn();
    const onSendInput = vi.fn(() => Promise.resolve(true));
    const offlineConnection = { lastSyncedAt: null, status: "offline" } as const;
    const approvalView = renderComposer({
      actionRequest: {
        command: "apply patch",
        kind: "approval",
        reason: "Agent wants to edit files",
        requestedAt: "2026-08-26T10:00:00.000Z"
      },
      liveUpdatesConnection: offlineConnection,
      onSendInput
    });

    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onSendInput).not.toHaveBeenCalled();

    approvalView.unmount();
    renderComposer({
      isPromptInFlight: true,
      liveUpdatesConnection: offlineConnection,
      onInterruptPrompt
    });

    expect(screen.getByRole("button", { name: "Interrupt prompt" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Interrupt prompt" }));
    expect(onInterruptPrompt).not.toHaveBeenCalled();
  });

  it("rechecks transport after a pending takeover confirmation", async () => {
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    const confirmation = new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve;
    });
    const onSendInput = vi.fn(() => Promise.resolve(true));
    const view = renderComposer({
      isPromptInFlight: true,
      liveUpdatesConnection: { lastSyncedAt: "2026-08-26T10:00:00.000Z", status: "live" },
      onSendInput,
      viewerCount: 2
    });

    requestConfirmation.mockReturnValue(confirmation);
    fireEvent.change(screen.getByRole("textbox", { name: "Next message" }), {
      target: { value: "replace after confirmation" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Interrupt current prompt and send message" }));

    await waitFor(() => expect(requestConfirmation).toHaveBeenCalledOnce());

    view.rerender(
      <SessionMessageComposer
        {...view.props}
        liveUpdatesConnection={{ lastSyncedAt: "2026-08-26T10:00:00.000Z", status: "offline" }}
      />
    );

    await act(() => {
      resolveConfirmation?.(true);
      return confirmation;
    });

    expect(onSendInput).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Next message" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Next message" }))
      .toHaveValue("replace after confirmation");
  });

  it("invalidates a pending takeover confirmation when the composer unmounts", async () => {
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    const confirmation = new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve;
    });
    const draftScopeKey = "session:unmounted-confirmation";
    const oldOnSendInput = vi.fn(() => Promise.resolve(true));
    const oldView = renderComposer({
      draftScopeKey,
      isPromptInFlight: true,
      liveUpdatesConnection: { lastSyncedAt: "2026-08-26T10:00:00.000Z", status: "live" },
      onSendInput: oldOnSendInput,
      viewerCount: 2
    });

    requestConfirmation.mockReturnValue(confirmation);
    fireEvent.change(screen.getByRole("textbox", { name: "Next message" }), {
      target: { value: "survive composer replacement" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Interrupt current prompt and send message" }));

    await waitFor(() => expect(requestConfirmation).toHaveBeenCalledOnce());

    oldView.unmount();

    const newOnSendInput = vi.fn(() => Promise.resolve(true));

    renderComposer({
      draftScopeKey,
      liveUpdatesConnection: { lastSyncedAt: "2026-08-26T10:00:00.000Z", status: "offline" },
      onSendInput: newOnSendInput
    });

    await act(() => {
      resolveConfirmation?.(true);
      return confirmation;
    });

    expect(oldOnSendInput).not.toHaveBeenCalled();
    expect(newOnSendInput).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Next message" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Next message" }))
      .toHaveValue("survive composer replacement");
  });

  it("invalidates a pending takeover confirmation when the draft scope changes", async () => {
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    const confirmation = new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve;
    });
    const oldOnSendInput = vi.fn(() => Promise.resolve(true));
    const view = renderComposer({
      draftScopeKey: "session:old-scope",
      isPromptInFlight: true,
      liveUpdatesConnection: { lastSyncedAt: "2026-08-26T10:00:00.000Z", status: "live" },
      onSendInput: oldOnSendInput,
      viewerCount: 2
    });

    requestConfirmation.mockReturnValue(confirmation);
    fireEvent.change(screen.getByRole("textbox", { name: "Next message" }), {
      target: { value: "old scope draft" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Interrupt current prompt and send message" }));

    await waitFor(() => expect(requestConfirmation).toHaveBeenCalledOnce());

    const newOnSendInput = vi.fn(() => Promise.resolve(true));

    view.rerender(
      <SessionMessageComposer
        {...view.props}
        draftScopeKey="session:new-scope"
        isPromptInFlight={false}
        onSendInput={newOnSendInput}
      />
    );

    await act(() => {
      resolveConfirmation?.(true);
      return confirmation;
    });

    expect(oldOnSendInput).not.toHaveBeenCalled();
    expect(newOnSendInput).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Next message" })).toHaveValue("");
  });

  it("does not clear a newer same-scope draft when an obsolete send is accepted", async () => {
    let resolveSend: ((sent: boolean) => void) | undefined;
    const pendingSend = new Promise<boolean>((resolve) => {
      resolveSend = resolve;
    });
    const draftScopeKey = "session:accepted-after-remount";
    const oldOnSendInput = vi.fn(() => pendingSend);
    const oldView = renderComposer({ draftScopeKey, onSendInput: oldOnSendInput });

    fireEvent.change(screen.getByRole("textbox", { name: "Next message" }), {
      target: { value: "old accepted draft" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(oldOnSendInput).toHaveBeenCalledOnce());

    oldView.unmount();

    const newView = renderComposer({ draftScopeKey });

    fireEvent.change(screen.getByRole("textbox", { name: "Next message" }), {
      target: { value: "new draft after accepted send" }
    });

    await act(() => {
      resolveSend?.(true);
      return pendingSend;
    });

    newView.unmount();
    renderComposer({ draftScopeKey });

    expect(screen.getByRole("textbox", { name: "Next message" }))
      .toHaveValue("new draft after accepted send");
  });

  it("clears an accepted draft from a same-scope composer mounted while send was pending", async () => {
    let resolveSend: ((sent: boolean) => void) | undefined;
    const pendingSend = new Promise<boolean>((resolve) => {
      resolveSend = resolve;
    });
    const draftScopeKey = "session:accepted-after-unedited-remount";
    const oldOnSendInput = vi.fn(() => pendingSend);
    const oldView = renderComposer({ draftScopeKey, onSendInput: oldOnSendInput });

    fireEvent.change(screen.getByRole("textbox", { name: "Next message" }), {
      target: { value: "accepted draft must not return" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(oldOnSendInput).toHaveBeenCalledOnce());

    oldView.unmount();

    const newView = renderComposer({ draftScopeKey });

    expect(screen.getByRole("textbox", { name: "Next message" }))
      .toHaveValue("accepted draft must not return");

    await act(() => {
      resolveSend?.(true);
      return pendingSend;
    });

    expect(screen.getByRole("textbox", { name: "Next message" })).toHaveValue("");

    newView.unmount();
    renderComposer({ draftScopeKey });

    expect(screen.getByRole("textbox", { name: "Next message" })).toHaveValue("");
  });

  it("does not restore a submitted cached draft while its send is pending", async () => {
    let resolveSend: ((sent: boolean) => void) | undefined;
    const pendingSend = new Promise<boolean>((resolve) => {
      resolveSend = resolve;
    });
    const draftScopeKey = "session:pending-restoration-timer";
    const preloadView = renderComposer({ draftScopeKey });

    fireEvent.change(screen.getByRole("textbox", { name: "Next message" }), {
      target: { value: "cached draft sent before timer" }
    });

    preloadView.unmount();

    const onSendInput = vi.fn(() => pendingSend);

    renderComposer({ draftScopeKey, onSendInput });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onSendInput).toHaveBeenCalledOnce());
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 300)));

    expect(screen.getByRole("textbox", { name: "Next message" })).toHaveValue("");

    await act(() => {
      resolveSend?.(true);
      return pendingSend;
    });

    expect(screen.getByRole("textbox", { name: "Next message" })).toHaveValue("");
  });

  it("does not restore an obsolete rejected draft over a newer same-scope draft", async () => {
    let resolveSend: ((sent: boolean) => void) | undefined;
    const pendingSend = new Promise<boolean>((resolve) => {
      resolveSend = resolve;
    });
    const draftScopeKey = "session:rejected-after-remount";
    const oldOnSendInput = vi.fn(() => pendingSend);
    const oldView = renderComposer({ draftScopeKey, onSendInput: oldOnSendInput });

    fireEvent.change(screen.getByRole("textbox", { name: "Next message" }), {
      target: { value: "old rejected draft" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(oldOnSendInput).toHaveBeenCalledOnce());

    oldView.unmount();

    const newView = renderComposer({ draftScopeKey });

    fireEvent.change(screen.getByRole("textbox", { name: "Next message" }), {
      target: { value: "new draft after rejected send" }
    });

    await act(() => {
      resolveSend?.(false);
      return pendingSend;
    });

    expect(screen.getByRole("textbox", { name: "Next message" }))
      .toHaveValue("new draft after rejected send");

    newView.unmount();
    renderComposer({ draftScopeKey });

    expect(screen.getByRole("textbox", { name: "Next message" }))
      .toHaveValue("new draft after rejected send");
  });

  it("does not clear a newer draft when an approval decision finishes", async () => {
    let resolveDecision: ((sent: boolean) => void) | undefined;
    const pendingDecision = new Promise<boolean>((resolve) => {
      resolveDecision = resolve;
    });
    const draftScopeKey = "session:approval-with-new-draft";
    const onSendInput = vi.fn(() => pendingDecision);
    const view = renderComposer({
      actionRequest: {
        command: "apply patch",
        kind: "approval",
        reason: "Agent wants to edit files",
        requestedAt: "2026-08-26T10:00:00.000Z"
      },
      draftScopeKey,
      onSendInput
    });

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(onSendInput).toHaveBeenCalledOnce());

    view.unmount();

    const newView = renderComposer({ draftScopeKey });

    fireEvent.change(screen.getByRole("textbox", { name: "Next message" }), {
      target: { value: "draft typed while approval is pending" }
    });

    await act(() => {
      resolveDecision?.(true);
      return pendingDecision;
    });

    newView.unmount();
    renderComposer({ draftScopeKey });

    expect(screen.getByRole("textbox", { name: "Next message" }))
      .toHaveValue("draft typed while approval is pending");
  });
});
