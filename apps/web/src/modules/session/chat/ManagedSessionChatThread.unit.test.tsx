import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@assets/images/icon-copy.svg?react", () => ({
  default: () => null
}));

import { buildManagedSessionChatThreadState } from "./helpers";
import { ManagedSessionChatThread } from "./ManagedSessionChatThread";
import styles from "./styles.module.scss";
import type {
  BuildManagedSessionChatThreadStateInput,
  ManagedSessionChatThreadProps
} from "./types";

type ChatThreadTestOverrides = Partial<BuildManagedSessionChatThreadStateInput> & {
  assistantDisplayName?: string;
  onRetryRecoveredPrompt?: ManagedSessionChatThreadProps["onRetryRecoveredPrompt"];
};

function renderChatThread(overrides: ChatThreadTestOverrides = {}) {
  const {
    assistantDisplayName = "Codex",
    onRetryRecoveredPrompt = vi.fn(() => Promise.resolve(true)),
    ...stateOverrides
  } = overrides;
  const state = buildManagedSessionChatThreadState({
    hasConversationContent: false,
    immediateInterruptPrompt: null,
    interruptLifecycle: {
      phase: "idle",
      requestedAt: null,
      confirmedAt: null,
      turnFingerprint: null,
      confirmation: null
    },
    isInterruptingPrompt: false,
    pendingChatPrompt: null,
    promptRecovery: null,
    shouldShowChatLoading: false,
    visibleConversationTimeline: [],
    waiting: { kind: "deskcue", detailEntry: null },
    ...stateOverrides
  });
  const props: ManagedSessionChatThreadProps = {
    assistantDisplayName,
    canRevealEarlierHistory: false,
    copyFeedback: null,
    hiddenConversationItemCount: 0,
    isActivityExpanded: () => false,
    isLoadingMoreHistory: false,
    renderActivityEntries: () => null,
    showScrollToLatest: false,
    state,
    threadRef: createRef<HTMLDivElement>(),
    onCopyMessage: vi.fn(),
    onHydrateActivityGroup: vi.fn(),
    onRevealEarlierHistory: vi.fn(),
    onRetryRecoveredPrompt,
    onScrollToLatest: vi.fn(),
    onToggleActivityGroup: vi.fn()
  };

  const view = render(<ManagedSessionChatThread {...props} />);

  return { props, ...view };
}

describe("ManagedSessionChatThread", () => {
  it("keeps long-running reply waits neutral instead of showing a timeout warning", () => {
    renderChatThread();

    expect(screen.getByText("Waiting for Codex reply")).toBeInTheDocument();
    expect(
      screen.getByText("DeskCue already sent the prompt and is watching the local chat file")
    ).toBeInTheDocument();
    expect(screen.queryByText(new RegExp("stall" + "ed", "i"))).not.toBeInTheDocument();
    expect(
      screen.queryByText(new RegExp(["has", "not", "seen", "new"].join(".*"), "i"))
    ).not.toBeInTheDocument();
  });

  it("uses the same User label for a pending DeskCue prompt", () => {
    renderChatThread({
      pendingChatPrompt: {
        text: "DeskCue-owned prompt",
        requestedAt: "2026-07-30T12:00:00.000Z",
        status: "waiting"
      }
    });

    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("does not call a queued prompt sent or show a reply wait before it starts", () => {
    renderChatThread({
      pendingChatPrompt: {
        text: "Wait for the current source turn",
        requestedAt: "2026-08-05T12:00:00.000Z",
        status: "queued"
      }
    });

    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for Codex reply")).not.toBeInTheDocument();
    expect(
      screen.queryByText("DeskCue already sent the prompt and is watching the local chat file")
    ).not.toBeInTheDocument();
  });

  it("shows a waiting block for a source turn started outside DeskCue", () => {
    const { container } = renderChatThread({
      waiting: {
        kind: "external",
        detailEntry: {
          id: "external-detail-1",
          phase: "commentary",
          role: "commentary",
          text: "Inspecting the external turn",
          timestamp: "2026-07-30T12:00:00.000Z"
        }
      }
    });

    expect(screen.getByText("Waiting for Codex reply")).toBeInTheDocument();
    expect(
      screen.getByText("Showing the latest live detail until the final reply lands")
    ).toBeInTheDocument();
    expect(screen.getByText("Inspecting the external turn")).toBeInTheDocument();
    expect(
      screen.queryByText("DeskCue is monitoring a turn that was already in progress")
    ).not.toBeInTheDocument();
    expect(container.querySelector(`.${styles.chatWaitingSpinner}`)).toBeInTheDocument();
  });

  it("describes a pre-existing source turn without implying a different control surface", () => {
    renderChatThread({
      waiting: { kind: "external", detailEntry: null }
    });

    expect(
      screen.getByText("DeskCue is monitoring a turn that was already in progress")
    ).toBeInTheDocument();
    expect(screen.queryByText(/outside DeskCue/i)).not.toBeInTheDocument();
  });

  it("shows an external Claude wait without requiring a live detail entry", () => {
    renderChatThread({
      assistantDisplayName: "Claude Code",
      waiting: { kind: "external", detailEntry: null }
    });

    expect(screen.getByText("Waiting for Claude Code reply")).toBeInTheDocument();
    expect(
      screen.getByText("DeskCue is monitoring a turn that was already in progress")
    ).toBeInTheDocument();
  });

  it("explains that DeskCue lost control while it checks history after restart", () => {
    renderChatThread({
      promptRecovery: {
        phase: "checking",
        promptText: "Potentially delivered prompt",
        requestedAt: "2026-08-11T12:00:00.000Z",
        retryable: false
      }
    });

    expect(screen.getByText("Checking turn status")).toBeInTheDocument();
    expect(
      screen.getByText(
        "DeskCue restarted during this turn and no longer has verified control. It is checking agent history and will not resend the prompt."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Checking delivery")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry prompt" })).not.toBeInTheDocument();
  });

  it("does not offer an unsafe resend when delivery is unknown", () => {
    renderChatThread({
      promptRecovery: {
        phase: "outcome_unknown",
        promptText: "Prompt with an unknown delivery outcome",
        requestedAt: "2026-08-11T12:00:00.000Z",
        retryable: false
      }
    });

    expect(screen.getByText("Turn outcome unknown")).toBeInTheDocument();
    expect(
      screen.getByText(
        "DeskCue found no final result and no longer has verified control. Check this chat in Codex before continuing; DeskCue will not resend the prompt."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry prompt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send again anyway" })).not.toBeInTheDocument();
  });

  it("offers an explicit retry only when the daemon confirms the prompt was not sent", async () => {
    const onRetryRecoveredPrompt = vi.fn(() => Promise.resolve(true));

    renderChatThread({
      onRetryRecoveredPrompt,
      promptRecovery: {
        phase: "not_sent",
        promptText: "Definitely not delivered prompt",
        requestedAt: "2026-08-11T12:00:00.000Z",
        retryable: true
      }
    });

    expect(screen.getByText("Prompt was not sent")).toBeInTheDocument();
    expect(screen.getByText("Not sent")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry prompt" }));

    await waitFor(() => expect(onRetryRecoveredPrompt).toHaveBeenCalledTimes(1));
  });

  it("shows stopping without the waiting detail while the server confirms an interrupt", () => {
    renderChatThread({
      interruptLifecycle: {
        phase: "requested",
        requestedAt: "2026-07-30T10:00:00.000Z",
        confirmedAt: null,
        turnFingerprint: "turn-1",
        confirmation: null
      }
    });

    expect(screen.getByText("Stopping current prompt")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for Codex reply")).not.toBeInTheDocument();
  });

  it("marks the DeskCue-owned prompt as stopping until transcript reconciliation", () => {
    renderChatThread({
      hasConversationContent: true,
      immediateInterruptPrompt: {
        text: "Stop this exact prompt",
        requestedAt: "2026-08-05T12:00:00.000Z",
        phase: "stopping"
      },
      waiting: { kind: "idle" },
      visibleConversationTimeline: [
        {
          type: "message",
          key: "user-1",
          role: "user",
          timestamp: "2026-08-05T12:00:00.000Z",
          continued: false,
          entry: {
            id: "user-1",
            phase: "final",
            role: "user",
            text: "Stop this exact prompt",
            timestamp: "2026-08-05T12:00:00.000Z"
          },
          activities: [],
          changeActivities: [],
          turnStatus: null
        }
      ]
    });

    expect(screen.getByText("Stopping")).toBeInTheDocument();
    expect(screen.queryByText("Interrupted by next prompt")).not.toBeInTheDocument();
  });

  it("keeps an interrupted DeskCue-owned prompt visible until its source entry arrives", () => {
    renderChatThread({
      hasConversationContent: false,
      immediateInterruptPrompt: {
        text: "Prompt that is absent from the source transcript",
        requestedAt: "2026-08-05T12:00:00.000Z",
        phase: "interrupted"
      },
      visibleConversationTimeline: [],
      waiting: { kind: "idle" }
    });

    expect(screen.getByText("Prompt that is absent from the source transcript")).toBeInTheDocument();
    expect(screen.getByTitle(
      "DeskCue interrupted this prompt; waiting for the source transcript to confirm"
    )).toHaveTextContent("Interrupted");
    expect(screen.queryByText("Waiting for Codex reply")).not.toBeInTheDocument();
  });

  it("does not attach an interrupt marker to an older turn with the same text", () => {
    const { container } = renderChatThread({
      hasConversationContent: true,
      immediateInterruptPrompt: {
        text: "Repeated prompt",
        requestedAt: "2026-08-05T13:00:00.000Z",
        phase: "interrupted"
      },
      waiting: { kind: "idle" },
      visibleConversationTimeline: [
        {
          type: "message",
          key: "old-user",
          role: "user",
          timestamp: "2026-08-05T12:00:00.000Z",
          continued: false,
          entry: {
            id: "old-user",
            phase: "final",
            role: "user",
            text: "Repeated prompt",
            timestamp: "2026-08-05T12:00:00.000Z"
          },
          activities: [],
          changeActivities: [],
          turnStatus: null
        }
      ]
    });

    const messages = container.querySelectorAll(`.${styles.chatMessageUser}`);

    expect(messages).toHaveLength(2);

    expect(messages[0]).not.toHaveTextContent("Interrupted");
    expect(messages[1]).toHaveTextContent("Interrupted");
  });

  it("keeps a reconciled transcript status instead of overwriting it locally", () => {
    renderChatThread({
      hasConversationContent: true,
      immediateInterruptPrompt: {
        text: "Stop this exact prompt",
        requestedAt: "2026-08-05T12:00:00.000Z",
        phase: "interrupted"
      },
      waiting: { kind: "idle" },
      visibleConversationTimeline: [
        {
          type: "message",
          key: "user-1",
          role: "user",
          timestamp: "2026-08-05T12:00:00.000Z",
          continued: false,
          entry: {
            id: "user-1",
            phase: "final",
            role: "user",
            text: "Stop this exact prompt",
            timestamp: "2026-08-05T12:00:00.000Z"
          },
          activities: [],
          changeActivities: [],
          turnStatus: {
            kind: "superseded",
            label: "Interrupted by next prompt",
            title: "Source transcript status"
          }
        }
      ]
    });

    expect(screen.getByText("Interrupted by next prompt")).toBeInTheDocument();
    expect(screen.queryByTitle(
      "DeskCue interrupted this prompt; waiting for the source transcript to confirm"
    )).not.toBeInTheDocument();
  });

  it("keeps an unresolved interrupt visible without transcript or waiting state", () => {
    renderChatThread({
      interruptLifecycle: {
        phase: "unresolved",
        requestedAt: "2026-07-30T10:00:00.000Z",
        confirmedAt: "2026-07-30T10:00:01.000Z",
        turnFingerprint: "turn-1",
        confirmation: "managed_transport"
      },
      waiting: { kind: "idle" }
    });

    expect(screen.getByText("Interrupt unconfirmed")).toBeInTheDocument();
    expect(
      screen.getByText("DeskCue has not received source confirmation; the prompt may still be running.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Waiting for Codex reply")).not.toBeInTheDocument();
  });

  it("keeps the scroll-to-latest button mounted so its visibility transition can finish", () => {
    const { props, rerender } = renderChatThread();
    const button = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Scroll to latest"]'
    );

    expect(button).not.toBeNull();
    expect(button).toHaveAttribute("aria-hidden", "true");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("tabindex", "-1");

    rerender(<ManagedSessionChatThread {...props} showScrollToLatest />);

    expect(screen.getByRole("button", { name: "Scroll to latest" })).toBeEnabled();
  });

});
