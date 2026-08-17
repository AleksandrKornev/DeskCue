import clsx from "clsx";

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
import type { ManagedSessionChatThreadProps } from "./types";

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
  renderActivityEntries,
  showScrollToLatest,
  state,
  threadRef
}: ManagedSessionChatThreadProps) {
  if (state.kind === "loading") return <ChatThreadLoadingState />;
  if (state.kind === "empty") return <ChatThreadEmptyState />;

  return (
    <>
      <div ref={threadRef} className={styles.chatThread}>
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
