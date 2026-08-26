import clsx from "clsx";
import { memo } from "react";

import { AgentChatBadge, isSubagentChat } from "@components/AgentChatBadge";
import { requestConfirmation } from "@components/ModalDialog";
import { Tooltip } from "@components/Tooltip";
import { formatDate } from "@lib/format";
import { useCurrentAgentSessionActionGuard } from "@modules/agents/useCurrentAgentSessionActionGuard";
import { ModelRuntimePanel } from "@modules/modelRuntime";
import { getDeskCueRuntime } from "@runtime";

import { getMarkReviewedSessionId } from "./helpers";
import styles from "./styles.module.scss";
import { TranscriptPreviewEntry } from "./TranscriptPreview";
import type { AgentTranscriptPanelProps } from "./types";
import { useAgentTranscriptPanelState } from "./useAgentTranscriptPanelState";

export const AgentTranscriptPanel = memo(function AgentTranscriptPanel(props: AgentTranscriptPanelProps) {
  const sessionCommandsEnabled = getDeskCueRuntime().features.sessionCommands;
  const {
    attachedManagedSessionId,
    attachedManagedSessionInfo,
    attaching,
    isLoading,
    previewItems,
    readyForReviewAgentSessionIds,
    session,
    sessionSummary,
    onAttach,
    onMarkReviewed,
    onOpenManagedSession,
  } = props;

  const {
    actionButtonLabel,
    attachWaitStage,
    attachedSessionHint,
    displaySession,
    hiddenPreviewText,
    isActionPending,
    isHydratingSelection,
    isOpeningSharedLiveThread,
    isReviewOnlyRuntime,
    isSharedLiveThread,
    isTranscriptPreviewLoading,
    showModelContext,
    sourceCapabilityLabel,
    textOnlyTranscriptEntries,
    transcriptRef,
    unavailableChatPresentation,
    visibleTextOnlyTranscriptEntries,
    setShowModelContext
  } = useAgentTranscriptPanelState({
    attachedManagedSessionId,
    attachedManagedSessionInfo,
    attaching,
    isLoading,
    previewItems,
    session,
    sessionSummary
  });
  const currentDisplaySessionIdRef = useCurrentAgentSessionActionGuard(
    displaySession?.id ?? null
  );

  if (isLoading && !displaySession) {
    return (
      <div className={clsx(styles.detail, styles.detailLoading)} aria-busy="true">
        <div className={styles.meta}>
          <div>
            <strong>Loading chat</strong>
            <span>Fetching local thread metadata</span>
          </div>
          <div className={styles.metaRight}>
            <span className={styles.capability}>Loading chat</span>
          </div>
        </div>

        <div className={clsx(styles.emptyState, styles.emptyStateSoft)}>
          <div className={styles.emptyStateTitle}>
            <span className={styles.spinner} aria-hidden="true" />
            <strong>Loading chat preview</strong>
          </div>
          <p>Fetching the local thread before opening the action card</p>
        </div>

        <div className={clsx(styles.bottom, styles.bottomAttached)}>
          <button
            className={clsx(styles.accentButton, styles.accentButtonLoading)}
            disabled
            type="button"
          >
            <span className={styles.spinner} aria-hidden="true" />
            <span>Loading chat...</span>
          </button>
        </div>
      </div>
    );
  }

  if (!displaySession) {
    return (
      <div className={styles.emptyState}>
        <strong>Select a local agent chat</strong>
        <p>DeskCue will show the transcript and let you take over that conversation from here</p>
      </div>
    );
  }

  const markReviewedSessionId = getMarkReviewedSessionId({
    displaySessionId: displaySession.id,
    isHydratingSelection,
    readyForReviewAgentSessionIds,
    sessionCommandsEnabled
  });

  return (
    <div className={clsx(styles.detail, isHydratingSelection && styles.detailSettling)}>
      <div className={styles.meta}>
        <div>
          <strong>
            <Tooltip
              className={styles.metaTitle}
              placement="below"
              value={displaySession.title}
            />
          </strong>
          <Tooltip
            className={styles.metaPath}
            placement="below"
            value={displaySession.workspacePath ?? "No workspace linked to this chat"}
          />
        </div>
        <div className={styles.metaRight}>
          {isSubagentChat(displaySession) ? <AgentChatBadge /> : null}
          <span className={styles.sourcePill}>{displaySession.agentLabel}</span>
          <button
            className={styles.metaButton}
            onClick={() => setShowModelContext(true)}
            type="button"
          >
            Model
          </button>
          <span className={styles.capability}>
            {sourceCapabilityLabel}
          </span>
          <span>{formatDate(displaySession.updatedAt)}</span>
        </div>
      </div>

      {showModelContext ? (
        <ModelRuntimePanel
          agentSession={displaySession}
          onClose={() => setShowModelContext(false)}
        />
      ) : null}

      {session && textOnlyTranscriptEntries.length > 0 ? (
        <div className={styles.transcript} ref={transcriptRef}>
          {visibleTextOnlyTranscriptEntries.map((entry) => (
            <TranscriptPreviewEntry
              assetContext={{ agentSessionId: displaySession.id }}
              entry={entry}
              key={entry.id}
            />
          ))}
        </div>
      ) : isTranscriptPreviewLoading ? (
        <div
          className={clsx(styles.emptyState, styles.emptyStateSoft)}
          aria-busy="true"
          aria-live="polite"
        >
          <div className={styles.emptyStateTitle}>
            <span className={styles.spinner} aria-hidden="true" />
            <strong>Loading chat preview</strong>
          </div>
          <p>DeskCue is loading the latest local transcript for this chat</p>
        </div>
      ) : (
        <div className={clsx(styles.emptyState, styles.emptyStateSoft)}>
          <strong>No message preview available</strong>
          <p>{hiddenPreviewText}</p>
        </div>
      )}

      <div className={clsx(styles.bottom, styles.bottomAttached)}>
        {!sessionCommandsEnabled ? (
          <p className={styles.nextMessageSubtle}>
            Remote control is disabled for this Cloud connection. Transcript review remains available.
          </p>
        ) : isReviewOnlyRuntime ? (
          <p className={styles.nextMessageSubtle}>
            This LM Studio chat is available for transcript review only
          </p>
        ) : (
          <button
            className={clsx(styles.accentButton, isActionPending && styles.accentButtonLoading)}
            disabled={isActionPending}
            onClick={async () => {
              const actionSessionId = displaySession.id;

              if (attachedManagedSessionId) {
                onOpenManagedSession(attachedManagedSessionId);
                return;
              }

              if (displaySession.attachMode !== "resume") {
                const confirmed = await requestConfirmation({
                  confirmLabel: unavailableChatPresentation?.confirmLabel ?? "Open view-only chat",
                  description:
                    unavailableChatPresentation?.description ??
                    "DeskCue will open the transcript and artifacts. Sending is unavailable for this chat.",
                  title: unavailableChatPresentation?.title ?? "Open view-only chat?"
                });

                if (!confirmed || currentDisplaySessionIdRef.current !== actionSessionId) return;
              }

              if (currentDisplaySessionIdRef.current !== actionSessionId) return;

              onAttach();
            }}
            type="button"
          >
            {isActionPending ? <span className={styles.spinner} aria-hidden="true" /> : null}
            <span>{actionButtonLabel}</span>
          </button>
        )}
        {markReviewedSessionId ? (
          <button
            className={styles.reviewedButton}
            onClick={() => onMarkReviewed(markReviewedSessionId)}
            type="button"
          >
            Mark reviewed
          </button>
        ) : null}
        {!isReviewOnlyRuntime && attachWaitStage === "slow" ? (
          <p className={styles.nextMessageSubtle}>
            {isOpeningSharedLiveThread
              ? "DeskCue is preparing the local transcript and will open the chat when the daemon replies"
              : "DeskCue is still attaching to the existing local chat. The agent keeps running."}
          </p>
        ) : !isReviewOnlyRuntime && attaching && attachWaitStage === "starting" && !isOpeningSharedLiveThread ? (
          <p className={styles.nextMessageSubtle}>
            DeskCue is attaching to the existing local chat. The agent is not being restarted.
          </p>
        ) : !isReviewOnlyRuntime && attachedSessionHint ? (
          <p className={styles.nextMessageSubtle}>
            {attachedSessionHint}
          </p>
        ) : !isReviewOnlyRuntime && !isHydratingSelection && isSharedLiveThread && displaySession.attachModeReason ? (
          <p className={styles.nextMessageSubtle}>
            {displaySession.attachModeReason}
          </p>
        ) : null}
      </div>
    </div>
  );
});

AgentTranscriptPanel.displayName = "AgentTranscriptPanel";
