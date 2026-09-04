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
  copyFeedback?: ManagedSessionChatThreadProps["copyFeedback"];
  isActivityExpanded?: ManagedSessionChatThreadProps["isActivityExpanded"];
  onHydrateActivityGroup?: ManagedSessionChatThreadProps["onHydrateActivityGroup"];
  onRetryRecoveredPrompt?: ManagedSessionChatThreadProps["onRetryRecoveredPrompt"];
  onToggleActivityGroup?: ManagedSessionChatThreadProps["onToggleActivityGroup"];
  renderActivityEntries?: ManagedSessionChatThreadProps["renderActivityEntries"];
};

function renderChatThread(overrides: ChatThreadTestOverrides = {}) {
  const {
    assistantDisplayName = "Codex",
    copyFeedback = null,
    isActivityExpanded = () => false,
    onHydrateActivityGroup = vi.fn(),
    onRetryRecoveredPrompt = vi.fn(() => Promise.resolve(true)),
    onToggleActivityGroup = vi.fn(),
    renderActivityEntries = () => null,
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
    copyFeedback,
    hiddenConversationItemCount: 0,
    isActivityExpanded,
    isLoadingMoreHistory: false,
    replyOutcome: null,
    renderActivityEntries,
    sessionKey: "session-a:agent-a",
    showScrollToLatest: false,
    state,
    threadRef: createRef<HTMLDivElement>(),
    onCopyMessage: vi.fn(),
    onHydrateActivityGroup,
    onRevealEarlierHistory: vi.fn(),
    onRetryRecoveredPrompt,
    onScrollToLatest: vi.fn(),
    onToggleActivityGroup
  };

  const view = render(<ManagedSessionChatThread {...props} />);

  return { props, ...view };
}

describe("ManagedSessionChatThread", () => {
  it("keeps the Copy action visibly attached to its message bubble", () => {
    const { container, props } = renderChatThread({
      hasConversationContent: true,
      visibleConversationTimeline: [{
        type: "message",
        key: "assistant-1",
        role: "assistant",
        timestamp: "2026-08-05T12:00:00.000Z",
        continued: false,
        entry: {
          id: "assistant-1",
          phase: "final",
          role: "assistant",
          text: "Completed the task",
          timestamp: "2026-08-05T12:00:00.000Z"
        },
        activities: [],
        changeActivities: [],
        turnStatus: null
      }],
      waiting: { kind: "idle" }
    });
    const copyButton = screen.getByRole("button", { name: "Copy message" });

    expect(copyButton).toHaveTextContent("Copy");
    expect(copyButton.closest(`.${styles.chatMessageBubble}`)).toBeInTheDocument();
    expect(container.querySelector(`.${styles.chatMessage} > .${styles.chatMessageFooter}`))
      .not.toBeInTheDocument();

    fireEvent.click(copyButton);
    expect(props.onCopyMessage).toHaveBeenCalledWith("assistant-1", "Completed the task");
  });

  it("keeps only the latest assistant Copy action primary in compact layouts", () => {
    const { container } = renderChatThread({
      hasConversationContent: true,
      visibleConversationTimeline: [
        {
          type: "message",
          key: "assistant-1",
          role: "assistant",
          timestamp: "2026-08-05T12:00:00.000Z",
          continued: false,
          entry: {
            id: "assistant-1",
            phase: "final",
            role: "assistant",
            text: "Earlier result",
            timestamp: "2026-08-05T12:00:00.000Z"
          },
          activities: [],
          changeActivities: [],
          turnStatus: null
        },
        {
          type: "message",
          key: "assistant-2",
          role: "assistant",
          timestamp: "2026-08-05T12:01:00.000Z",
          continued: false,
          entry: {
            id: "assistant-2",
            phase: "final",
            role: "assistant",
            text: "Latest result",
            timestamp: "2026-08-05T12:01:00.000Z"
          },
          activities: [],
          changeActivities: [],
          turnStatus: null
        },
        {
          type: "message",
          key: "user-1",
          role: "user",
          timestamp: "2026-08-05T12:02:00.000Z",
          continued: false,
          entry: {
            id: "user-1",
            phase: "final",
            role: "user",
            text: "Follow-up prompt",
            timestamp: "2026-08-05T12:02:00.000Z"
          },
          activities: [],
          changeActivities: [],
          turnStatus: null
        }
      ],
      waiting: { kind: "idle" }
    });
    const earlierFooter = container
      .querySelector("[data-chat-message-id='assistant-1']")
      ?.querySelector(`.${styles.chatMessageFooter}`);
    const latestAssistantFooter = container
      .querySelector("[data-chat-message-id='assistant-2']")
      ?.querySelector(`.${styles.chatMessageFooter}`);
    const userFooter = container
      .querySelector("[data-chat-message-id='user-1']")
      ?.querySelector(`.${styles.chatMessageFooter}`);

    expect(earlierFooter).toHaveClass(styles.chatMessageFooterMobileSecondary);
    expect(latestAssistantFooter).not.toHaveClass(styles.chatMessageFooterMobileSecondary);
    expect(userFooter).toHaveClass(styles.chatMessageFooterMobileSecondary);
  });

  it("keeps one persistent atomic Copy status without moving the action", () => {
    const view = renderChatThread({
      copyFeedback: null,
      hasConversationContent: true,
      visibleConversationTimeline: [{
        type: "message",
        key: "user-1",
        role: "user",
        timestamp: "2026-08-05T12:00:00.000Z",
        continued: false,
        entry: {
          id: "user-1",
          phase: "final",
          role: "user",
          text: "Check this result",
          timestamp: "2026-08-05T12:00:00.000Z"
        },
        activities: [],
        changeActivities: [],
        turnStatus: null
      }],
      waiting: { kind: "idle" }
    });
    const status = view.container.querySelector(`.${styles.chatMessageActionStatus}`);

    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toBeEmptyDOMElement();

    view.rerender(
      <ManagedSessionChatThread
        {...view.props}
        copyFeedback={{ messageId: "user-1", status: "copied" }}
      />
    );

    expect(view.container.querySelector(`.${styles.chatMessageActionStatus}`)).toBe(status);
    expect(status).toHaveTextContent("Copied");
    expect(screen.getByRole("button", { name: "Copy message" })).toHaveTextContent("Copied");
    expect(screen.getByRole("button", { name: "Copy message" })).toHaveAttribute(
      "data-feedback-label",
      "Message copied"
    );
  });

  it("keeps long-running reply waits neutral and announces their completion", async () => {
    const view = renderChatThread();

    expect(screen.getByText("Waiting for Codex reply")).toBeInTheDocument();
    const waitingStatus = screen.getByText("Codex reply in progress");
    const busySurface = screen.getByText("Waiting for Codex reply").closest("[aria-busy='true']");

    expect(styles.srOnly).toBeTruthy();
    expect(waitingStatus).toHaveClass(styles.srOnly);
    expect(waitingStatus).toHaveAttribute("role", "status");
    expect(busySurface).toBeInTheDocument();
    expect(busySurface).not.toContainElement(waitingStatus);
    expect(
      screen.getByText("DeskCue already sent the prompt and is watching the local chat file")
    ).toBeInTheDocument();
    expect(screen.queryByText(new RegExp("stall" + "ed", "i"))).not.toBeInTheDocument();
    expect(
      screen.queryByText(new RegExp(["has", "not", "seen", "new"].join(".*"), "i"))
    ).not.toBeInTheDocument();

    const idleState = buildManagedSessionChatThreadState({
      hasConversationContent: true,
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
      visibleConversationTimeline: [{
        type: "message",
        key: "assistant-complete",
        role: "assistant",
        timestamp: "2026-09-02T12:00:01.000Z",
        continued: false,
        entry: {
          id: "assistant-complete",
          phase: "final",
          role: "assistant",
          text: "Done",
          timestamp: "2026-09-02T12:00:01.000Z"
        },
        activities: [],
        changeActivities: [],
        turnStatus: null
      }],
      waiting: { kind: "idle" }
    });

    view.rerender(
      <ManagedSessionChatThread {...view.props} replyOutcome="completed" state={idleState} />
    );

    await waitFor(() => expect(screen.getByText("Codex reply received")).toHaveAttribute(
      "role",
      "status"
    ));
  });

  it("announces stopping without falsely announcing a received reply", async () => {
    const view = renderChatThread();
    const stoppingState = buildManagedSessionChatThreadState({
      hasConversationContent: false,
      immediateInterruptPrompt: null,
      interruptLifecycle: {
        phase: "idle",
        requestedAt: null,
        confirmedAt: null,
        turnFingerprint: null,
        confirmation: null
      },
      isInterruptingPrompt: true,
      pendingChatPrompt: null,
      promptRecovery: null,
      shouldShowChatLoading: false,
      visibleConversationTimeline: [],
      waiting: { kind: "idle" }
    });

    view.rerender(<ManagedSessionChatThread {...view.props} state={stoppingState} />);

    await waitFor(() => expect(screen.getAllByText("Stopping current prompt").some(
      (element) => element.getAttribute("role") === "status"
    )).toBe(true));
    expect(screen.queryByText("Codex reply received")).not.toBeInTheDocument();

    const interruptedState = buildManagedSessionChatThreadState({
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
      waiting: { kind: "idle" }
    });

    view.rerender(
      <ManagedSessionChatThread
        {...view.props}
        replyOutcome="interrupted"
        state={interruptedState}
      />
    );

    await waitFor(() => expect(screen.getByText("Codex reply interrupted")).toHaveAttribute(
      "role",
      "status"
    ));
  });

  it("clears the reply announcement on a session reset", async () => {
    const view = renderChatThread();

    view.rerender(
      <ManagedSessionChatThread
        {...view.props}
        sessionKey="session-b:agent-b"
        state={{ kind: "empty" }}
      />
    );

    await waitFor(() => expect(screen.queryByText("Codex reply in progress"))
      .not.toBeInTheDocument());
    expect(screen.queryByText("Codex reply received")).not.toBeInTheDocument();
  });

  it("preserves activity focus when a terminal group moves into the final reply", () => {
    const activity = {
      entries: [],
      id: "tools:source-10",
      kind: "tools" as const,
      label: "Tools (3)",
      sourceEntryIds: ["source-10"],
      timestamp: "2026-09-02T12:00:00.000Z"
    };

    const view = renderChatThread({
      hasConversationContent: true,
      visibleConversationTimeline: [{
        type: "activity",
        key: activity.id,
        activity
      }],
      waiting: { kind: "idle" }
    });
    const standaloneToggle = screen.getByRole("button", { name: /Tools \(3\)/i });

    standaloneToggle.focus();
    expect(standaloneToggle).toHaveFocus();

    const finalState = buildManagedSessionChatThreadState({
      hasConversationContent: true,
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
      visibleConversationTimeline: [{
        type: "message",
        key: "assistant-1",
        role: "assistant",
        timestamp: "2026-09-02T12:00:01.000Z",
        continued: false,
        entry: {
          id: "assistant-1",
          phase: "final",
          role: "assistant",
          text: "Done",
          timestamp: "2026-09-02T12:00:01.000Z"
        },
        activities: [{
          ...activity,
          id: "tools:source-10:source-11",
          label: "Tools (4)",
          sourceEntryIds: ["source-10", "source-11"]
        }],
        changeActivities: [],
        turnStatus: null
      }],
      waiting: { kind: "idle" }
    });

    standaloneToggle.blur();
    view.rerender(<ManagedSessionChatThread {...view.props} state={finalState} />);

    expect(screen.getByRole("button", { name: "Tools (4)" })).not.toHaveFocus();

    view.rerender(<ManagedSessionChatThread {...view.props} />);
    screen.getByRole("button", { name: /Tools \(3\)/i }).focus();
    view.rerender(<ManagedSessionChatThread {...view.props} state={finalState} />);

    const attachedToggle = screen.getByRole("button", { name: "Tools (4)" });

    expect(attachedToggle).toHaveFocus();

    attachedToggle.blur();
    view.rerender(<ManagedSessionChatThread {...view.props} state={{ ...finalState }} />);
    expect(attachedToggle).not.toHaveFocus();
  });

  it("moves standalone Changes focus to its always-visible final reply region", () => {
    const activity = {
      entries: [],
      id: "changes:source-10",
      kind: "changes" as const,
      label: "Changes (2)",
      sourceEntryIds: ["source-10"],
      timestamp: "2026-09-04T12:00:00.000Z"
    };

    const view = renderChatThread({
      hasConversationContent: true,
      visibleConversationTimeline: [{
        type: "activity",
        key: activity.id,
        activity
      }],
      waiting: { kind: "idle" }
    });
    const standaloneToggle = screen.getByRole("button", { name: /Changes \(2\)/i });

    standaloneToggle.focus();
    expect(standaloneToggle).toHaveFocus();

    const finalState = buildManagedSessionChatThreadState({
      hasConversationContent: true,
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
      visibleConversationTimeline: [{
        type: "message",
        key: "assistant-1",
        role: "assistant",
        timestamp: "2026-09-04T12:00:01.000Z",
        continued: false,
        entry: {
          id: "assistant-1",
          phase: "final",
          role: "assistant",
          text: "Done",
          timestamp: "2026-09-04T12:00:01.000Z"
        },
        activities: [],
        changeActivities: [{ ...activity, id: "changes:source-10:source-11" }],
        turnStatus: null
      }],
      waiting: { kind: "idle" }
    });

    view.rerender(<ManagedSessionChatThread {...view.props} state={finalState} />);

    expect(screen.queryByRole("button", { name: /Changes \(2\)/i })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Changes (2)" })).toHaveFocus();
  });

  it("keeps attached changes visible without a disclosure chip", () => {
    const onToggleActivityGroup = vi.fn();

    renderChatThread({
      hasConversationContent: true,
      onToggleActivityGroup,
      renderActivityEntries: (activity) => <p>{activity.kind} content</p>,
      visibleConversationTimeline: [{
        type: "message",
        key: "assistant-1",
        role: "assistant",
        timestamp: "2026-09-04T12:00:00.000Z",
        continued: false,
        entry: {
          id: "assistant-1",
          phase: "final",
          role: "assistant",
          text: "Implemented the requested update",
          timestamp: "2026-09-04T12:00:00.000Z"
        },
        activities: [{
          entries: [],
          id: "tools:source-10",
          kind: "tools",
          label: "Tools (3)",
          timestamp: "2026-09-04T11:59:58.000Z"
        }],
        changeActivities: [{
          entries: [],
          id: "changes:source-11",
          kind: "changes",
          label: "Changes (2)",
          timestamp: "2026-09-04T11:59:59.000Z"
        }],
        turnStatus: null
      }],
      waiting: { kind: "idle" }
    });

    expect(screen.getByRole("button", { name: "Tools (3)" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    expect(screen.queryByRole("button", { name: "Changes (2)" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Changes (2)" })).toHaveTextContent(
      "changes content"
    );

    expect(screen.queryByText("tools content")).not.toBeInTheDocument();
    expect(onToggleActivityGroup).not.toHaveBeenCalled();
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
      screen.queryByText("DeskCue is monitoring a turn started outside DeskCue")
    ).not.toBeInTheDocument();
    expect(container.querySelector(`.${styles.chatWaitingSpinner}`)).toBeInTheDocument();
  });

  it("describes a pre-existing source turn as running outside DeskCue", () => {
    renderChatThread({
      waiting: { kind: "external", detailEntry: null }
    });

    expect(
      screen.getByText("DeskCue is monitoring a turn started outside DeskCue")
    ).toBeInTheDocument();
  });

  it("shows an external Claude wait without requiring a live detail entry", () => {
    renderChatThread({
      assistantDisplayName: "Claude Code",
      waiting: { kind: "external", detailEntry: null }
    });

    expect(screen.getByText("Waiting for Claude Code reply")).toBeInTheDocument();
    expect(
      screen.getByText("DeskCue is monitoring a turn started outside DeskCue")
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

    expect(screen.getByText("Reconciling turn outcome")).toBeInTheDocument();
    expect(
      screen.getByText(
        "DeskCue lost the prompt transport during this turn. It is checking the source agent's history and will not resend the prompt."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Checking outcome")).toBeInTheDocument();
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

    expect(screen.getByText("Prompt delivery unknown")).toBeInTheDocument();
    expect(
      screen.getByText(
        "DeskCue could not confirm whether the source agent received this prompt or how the turn ended. It will not resend the prompt automatically."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry prompt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send again anyway" })).not.toBeInTheDocument();
  });

  it("distinguishes an observed prompt with an unknown terminal outcome", () => {
    renderChatThread({
      promptRecovery: {
        observedPromptAt: "2026-08-11T12:00:01.000Z",
        phase: "outcome_unknown",
        promptText: "Prompt recorded by the source agent",
        requestedAt: "2026-08-11T12:00:00.000Z",
        retryable: false
      }
    });

    expect(screen.getByText("Turn outcome unknown")).toBeInTheDocument();
    expect(screen.getByText("Outcome unknown")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The source agent recorded this prompt, but DeskCue could not confirm how the turn ended. DeskCue will not resend it automatically."
      )
    ).toBeInTheDocument();
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
