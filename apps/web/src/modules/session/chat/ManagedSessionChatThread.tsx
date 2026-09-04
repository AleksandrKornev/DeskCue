import clsx from "clsx";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import type { FocusEvent } from "react";

import { doAgentTranscriptSourceRefsOverlap } from "@deskcue/protocol";
import type { ConversationActivity } from "@modules/session/types";

import {
  ChatInlineActivityItem,
  ChatLifecycleActivity
} from "./ChatThreadActivityBlocks";
import { ChatThreadMessage } from "./ChatThreadMessage";
import { ChatThreadOperationStatus } from "./ChatThreadOperationStatus";
import { ChatThreadPendingPrompt } from "./ChatThreadPendingPrompt";
import {
  ChatThreadEmptyState,
  ChatThreadLoadingState
} from "./ChatThreadStatePanels/index";
import styles from "./styles.module.scss";
import type {
  ManagedSessionChatThreadProps,
  ManagedSessionChatThreadState,
  ReplyOutcome
} from "./types";

type FocusedActivity = {
  activity: ConversationActivity;
  sessionKey: string;
};

function readTimelineActivities(state: ManagedSessionChatThreadState) {
  if (state.kind !== "ready") return [];

  return state.timeline.flatMap((item) =>
    item.type === "activity"
      ? [item.activity]
      : item.type === "message"
        ? [...item.activities, ...item.changeActivities]
        : []
  );
}

function findLatestAssistantCopyMessageKey(state: ManagedSessionChatThreadState) {
  if (state.kind !== "ready") return null;

  for (let index = state.timeline.length - 1; index >= 0; index -= 1) {
    const item = state.timeline[index];

    if (item?.type === "message" && item.role === "assistant" && item.entry.text.trim()) {
      return item.key;
    }
  }

  return null;
}

function findConnectedActivity(
  state: ManagedSessionChatThreadState,
  focusedActivity: ConversationActivity
) {
  return readTimelineActivities(state).find((activity) =>
    activity.kind === focusedActivity.kind &&
    (
      activity.id === focusedActivity.id ||
      doAgentTranscriptSourceRefsOverlap(activity, focusedActivity)
    )
  ) ?? null;
}

function findActivityFocusTarget(root: HTMLElement, activityId: string) {
  return Array.from(
    root.querySelectorAll<HTMLElement>("[data-chat-activity-id]")
  ).find((element) => element.dataset.chatActivityId === activityId) ?? null;
}

function useActivityFocusContinuity(
  sessionKey: string,
  threadRef: ManagedSessionChatThreadProps["threadRef"],
  state: ManagedSessionChatThreadState
) {
  const focusedActivityRef = useRef<FocusedActivity | null>(null);

  useLayoutEffect(() => {
    const root = threadRef.current;
    const focusedActivity = focusedActivityRef.current;

    if (!root || !focusedActivity) return;

    if (focusedActivity.sessionKey !== sessionKey) {
      focusedActivityRef.current = null;

      return;
    }

    const activeElement = document.activeElement;

    if (!activeElement || activeElement === document.body) {
      const connectedActivity = findConnectedActivity(state, focusedActivity.activity);

      if (connectedActivity) findActivityFocusTarget(root, connectedActivity.id)?.focus();

      focusedActivityRef.current = null;

      return;
    }

    if (!root.contains(activeElement)) focusedActivityRef.current = null;
  }, [sessionKey, state, threadRef]);

  return {
    handleBlurCapture(event: FocusEvent<HTMLDivElement>) {
      if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;

      focusedActivityRef.current = null;
    },
    handleFocusCapture(event: FocusEvent<HTMLDivElement>) {
      const activityId = event.target.closest<HTMLElement>(
        "[data-chat-activity-id]"
      )?.dataset.chatActivityId;
      const activity = activityId
        ? readTimelineActivities(state).find((candidate) => candidate.id === activityId)
        : null;

      focusedActivityRef.current = activity ? { activity, sessionKey } : null;
    }
  };
}

function readReplyTransitionAnnouncement(
  assistantDisplayName: string,
  replyOutcome: ReplyOutcome,
  state: ManagedSessionChatThreadState
) {
  if (state.kind === "ready" && state.operation.kind === "stopping") {
    return "Stopping current prompt";
  }

  if (state.kind === "ready" && state.operation.kind === "interrupt-unconfirmed") {
    return "Reply interruption unconfirmed";
  }

  if (state.kind === "ready" && state.operation.kind === "recovery") {
    return state.operation.title;
  }

  if (replyOutcome === "completed") return `${assistantDisplayName} reply received`;
  if (replyOutcome === "failed") return `${assistantDisplayName} reply failed`;
  if (replyOutcome === "interrupted") return `${assistantDisplayName} reply interrupted`;

  return `${assistantDisplayName} reply ended without a final response`;
}

function useReplyStatusAnnouncement(
  assistantDisplayName: string,
  replyOutcome: ReplyOutcome,
  sessionKey: string,
  state: ManagedSessionChatThreadState
) {
  const isReplyWaiting = state.kind === "ready" && state.operation.kind === "waiting";
  const previousStateRef = useRef({ isReplyWaiting, replyOutcome, sessionKey });
  const [announcementState, setAnnouncementState] = useState({
    sessionKey,
    text: isReplyWaiting ? `${assistantDisplayName} reply in progress` : ""
  });
  const previousState = previousStateRef.current;
  const immediateTransitionAnnouncement =
    previousState.sessionKey === sessionKey &&
    (
      replyOutcome !== null && replyOutcome !== previousState.replyOutcome ||
      previousState.isReplyWaiting && !isReplyWaiting
    )
    ? readReplyTransitionAnnouncement(assistantDisplayName, replyOutcome, state)
    : "";

  useEffect(() => {
    const previousReplyState = previousStateRef.current;
    let nextAnnouncement = announcementState.text;

    if (previousReplyState.sessionKey !== sessionKey) {
      nextAnnouncement = isReplyWaiting ? `${assistantDisplayName} reply in progress` : "";
    } else if (isReplyWaiting) {
      nextAnnouncement = `${assistantDisplayName} reply in progress`;
    } else if (replyOutcome !== null && replyOutcome !== previousReplyState.replyOutcome) {
      nextAnnouncement = readReplyTransitionAnnouncement(
        assistantDisplayName,
        replyOutcome,
        state
      );
    } else if (previousReplyState.isReplyWaiting) {
      nextAnnouncement = readReplyTransitionAnnouncement(
        assistantDisplayName,
        replyOutcome,
        state
      );
    }

    setAnnouncementState({ sessionKey, text: nextAnnouncement });
    previousStateRef.current = { isReplyWaiting, replyOutcome, sessionKey };
  }, [
    announcementState.text,
    assistantDisplayName,
    isReplyWaiting,
    replyOutcome,
    sessionKey,
    state
  ]);

  if (immediateTransitionAnnouncement) return immediateTransitionAnnouncement;

  return announcementState.sessionKey === sessionKey ? announcementState.text : "";
}

export function ManagedSessionChatThread({
  assistantDisplayName,
  assetContext,
  canRevealEarlierHistory,
  copyFeedback,
  hiddenConversationItemCount,
  isActivityExpanded,
  isLoadingMoreHistory,
  onCopyMessage,
  onHydrateActivityGroup,
  onRevealEarlierHistory,
  onRetryRecoveredPrompt,
  onScrollToLatest,
  onToggleActivityGroup,
  replyOutcome,
  renderActivityEntries,
  sessionKey,
  showScrollToLatest,
  state,
  threadRef
}: ManagedSessionChatThreadProps) {
  const {
    handleBlurCapture: handleThreadBlurCapture,
    handleFocusCapture: handleThreadFocusCapture
  } = useActivityFocusContinuity(sessionKey, threadRef, state);

  const replyStatusAnnouncement = useReplyStatusAnnouncement(
    assistantDisplayName || "agent",
    replyOutcome,
    sessionKey,
    state
  );
  const latestAssistantCopyMessageKey = findLatestAssistantCopyMessageKey(state);
  const replyStatus = (
    <span
      aria-atomic="true"
      aria-live="polite"
      className={styles.srOnly}
      role="status"
    >
      {replyStatusAnnouncement}
    </span>
  );

  if (state.kind === "loading") return <><ChatThreadLoadingState />{replyStatus}</>;
  if (state.kind === "empty") return <><ChatThreadEmptyState />{replyStatus}</>;

  return (
    <>
      <div
        aria-label="Conversation messages"
        ref={threadRef}
        className={styles.chatThread}
        onBlurCapture={handleThreadBlurCapture}
        onFocusCapture={handleThreadFocusCapture}
        role="region"
        tabIndex={0}
      >
        {canRevealEarlierHistory || isLoadingMoreHistory ? (
          <div className={styles.chatHistoryGate} data-chat-history-gate>
            <button
              className={clsx(
                styles.smallGhostButton,
                isLoadingMoreHistory && styles.chatHistoryGateButtonLoading
              )}
              disabled={isLoadingMoreHistory}
              onClick={onRevealEarlierHistory}
              type="button"
            >
              {isLoadingMoreHistory ? (
                <>
                  <span className={styles.chatHistoryGateSpinner} aria-hidden="true" />
                  <span>Loading earlier messages...</span>
                </>
              ) : hiddenConversationItemCount > 0 ? (
                `Load earlier messages (${hiddenConversationItemCount} hidden)`
              ) : (
                "Load earlier messages"
              )}
            </button>
          </div>
        ) : null}

        {state.timeline.map((item) =>
          item.type === "day" ? (
            <div key={item.key} className={styles.chatDaySeparator}>
              <span>{item.label}</span>
            </div>
          ) : item.type === "activity" && ["context", "model"].includes(item.activity.kind) ? (
            <ChatLifecycleActivity key={item.key} activity={item.activity} />
          ) : item.type === "activity" ? (
            <ChatInlineActivityItem
              key={item.key}
              activity={item.activity}
              isExpanded={isActivityExpanded(item.activity)}
              renderActivityEntries={renderActivityEntries}
              onHydrate={onHydrateActivityGroup}
              onToggle={() => onToggleActivityGroup(item.activity)}
            />
          ) : (
            <ChatThreadMessage
              key={item.key}
              assistantDisplayName={assistantDisplayName}
              assetContext={assetContext}
              copyFeedback={copyFeedback}
              isActivityExpanded={isActivityExpanded}
              isPrimaryMobileCopyAction={item.key === latestAssistantCopyMessageKey}
              item={item}
              renderActivityEntries={renderActivityEntries}
              onHydrateActivityGroup={onHydrateActivityGroup}
              onCopyMessage={onCopyMessage}
              onToggleActivityGroup={onToggleActivityGroup}
            />
          )
        )}

        {state.pendingPrompt ? (
          <ChatThreadPendingPrompt
            assetContext={assetContext}
            prompt={state.pendingPrompt}
          />
        ) : null}

        {state.operation.kind !== "idle" ? (
          <ChatThreadOperationStatus
            key={state.operation.kind === "recovery"
              ? `recovery:${state.operation.identity}`
              : state.operation.kind}
            assistantDisplayName={assistantDisplayName}
            assetContext={assetContext}
            operation={state.operation}
            onRetryRecoveredPrompt={onRetryRecoveredPrompt}
          />
        ) : null}
      </div>

      {replyStatus}

      <span
        aria-atomic="true"
        aria-live="polite"
        className={styles.chatMessageActionStatus}
        role="status"
      >
        {copyFeedback
          ? copyFeedback.status === "copied"
            ? "Copied"
            : "Copy failed"
          : ""}
      </span>

      <button
        aria-hidden={!showScrollToLatest}
        aria-label="Scroll to latest"
        className={clsx(
          styles.scrollButton,
          showScrollToLatest ? styles.scrollButtonVisible : styles.scrollButtonHidden
        )}
        disabled={!showScrollToLatest}
        onClick={onScrollToLatest}
        tabIndex={showScrollToLatest ? 0 : -1}
        title="Scroll to latest"
        type="button"
      >
        <span className={styles.scrollButtonIcon} aria-hidden="true">
          ↓
        </span>
      </button>
    </>
  );
}
