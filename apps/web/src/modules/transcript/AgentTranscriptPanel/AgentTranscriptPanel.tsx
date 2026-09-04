import clsx from "clsx";
import { memo, useEffect, useRef } from "react";

import ModelIcon from "@assets/images/icon-sliders.svg?react";
import { AgentChatBadge, isSubagentChat } from "@components/AgentChatBadge";
import { AgentRuntimeIcon } from "@components/AgentRuntimeIcon";
import { Tooltip } from "@components/Tooltip";
import { formatDate } from "@lib/format";
import { useAgentSessionConfirmationGuard } from "@modules/agents/useAgentSessionConfirmationGuard";
import { useCurrentAgentSessionActionGuard } from "@modules/agents/useCurrentAgentSessionActionGuard";
import { ModelRuntimePanel } from "@modules/modelRuntime";
import {
  getDeskCueRuntime,
  resolveSessionCommandsUnavailableReason
} from "@runtime";

import { AgentTranscriptLoadError } from "./AgentTranscriptLoadError";
import { getMarkReviewedSessionId } from "./helpers";
import styles from "./styles.module.scss";
import { TranscriptPreviewEntry } from "./TranscriptPreview";
import type { AgentTranscriptPanelProps } from "./types";
import { useAgentTranscriptPanelState } from "./useAgentTranscriptPanelState";

export const AgentTranscriptPanel = memo(function AgentTranscriptPanel(props: AgentTranscriptPanelProps) {
  const runtime = getDeskCueRuntime();
  const sessionCommandsEnabled = runtime.features.sessionCommands;
  const sessionCommandsUnavailableReason = resolveSessionCommandsUnavailableReason(runtime);
  const {
    attachedManagedSessionId,
    attachedManagedSessionInfo,
    attaching,
    isLoading,
    loadError,
    previewItems,
    readyForReviewAgentSessionIds,
    selectedSessionId,
    session,
    sessionSummary,
    onAttach,
    onMarkReviewed,
    onOpenManagedSession,
    onRetryLoad,
  } = props;

  const {
    actionButtonLabel,
    attachWaitStage,
    attachedSessionHint,
    displaySession,
    displayedSessionDetail,
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
    loadError,
    previewItems,
    selectedSessionId,
    session,
    sessionSummary
  });
  const currentDisplaySessionIdRef = useCurrentAgentSessionActionGuard(
    displaySession?.id ?? null
  );
  const requestCurrentSessionConfirmation = useAgentSessionConfirmationGuard({
    accessKey: displaySession
      ? [
          displaySession.attachMode,
          displaySession.workState,
          displaySession.agentId,
          displaySession.originator ?? ""
        ].join(":")
      : "",
    sessionId: displaySession?.id ?? null
  });
  const detailFocusRef = useRef<HTMLDivElement>(null);
  const loadRecoveryFocusOwnerRef = useRef<{
    element: HTMLButtonElement;
    sessionId: string;
  } | null>(null);

  useEffect(() => {
    const focusOwner = loadRecoveryFocusOwnerRef.current;

    if (!focusOwner) return;

    if (focusOwner.sessionId !== selectedSessionId) {
      loadRecoveryFocusOwnerRef.current = null;
      return;
    }

    if (loadError || isLoading) return;
    if (!displaySession || displaySession.id !== selectedSessionId) return;

    const activeElement = document.activeElement;
    const focusReturnedToDocument =
      activeElement === document.body || activeElement === document.documentElement;
    const focusMovedElsewhere = focusOwner.element.isConnected
      ? activeElement !== focusOwner.element
      : !focusReturnedToDocument;

    if (focusMovedElsewhere) {
      loadRecoveryFocusOwnerRef.current = null;
      return;
    }

    detailFocusRef.current?.focus();
    loadRecoveryFocusOwnerRef.current = null;
  }, [displaySession, isLoading, loadError, selectedSessionId]);

  const hasBlockingLoadError = Boolean(loadError && !displayedSessionDetail && onRetryLoad);

  if (hasBlockingLoadError && !displaySession && loadError && onRetryLoad) {
    return (
      <div className={clsx(styles.detail, styles.detailLoading)}>
        <AgentTranscriptLoadError
          errorMessage={loadError}
          isRetrying={isLoading}
          onFocusOwnershipChange={(focusOwner) => {
            loadRecoveryFocusOwnerRef.current = focusOwner
              ? { element: focusOwner, sessionId: selectedSessionId }
              : null;
          }}
          onRetry={onRetryLoad}
        />
      </div>
    );
  }

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
    <div
      aria-label={`${displaySession.title} chat details`}
      className={clsx(styles.detail, isHydratingSelection && styles.detailSettling)}
      ref={detailFocusRef}
      tabIndex={-1}
    >
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
          <span
            className={clsx(
              styles.capability,
              sourceCapabilityLabel === "Ready" && styles.capabilityReady
            )}
          >
            {sourceCapabilityLabel}
          </span>
          {isSubagentChat(displaySession) ? <AgentChatBadge /> : null}
          <span className={styles.sourcePill}>
            <AgentRuntimeIcon
              aria-hidden="true"
              className={styles.sourcePillIcon}
              runtimeId={displaySession.agentId}
            />
            {displaySession.agentLabel}
          </span>
          <button
            aria-label="Model details"
            className={styles.metaButton}
            onClick={() => setShowModelContext(true)}
            title="Model details"
            type="button"
          >
            <ModelIcon aria-hidden="true" className={styles.metaButtonIcon} focusable="false" />
          </button>
          <span>{formatDate(displaySession.updatedAt)}</span>
        </div>
      </div>

      {showModelContext ? (
        <ModelRuntimePanel
          agentSession={displaySession}
          onClose={() => setShowModelContext(false)}
        />
      ) : null}

      {hasBlockingLoadError && loadError && onRetryLoad ? (
        <AgentTranscriptLoadError
          errorMessage={loadError}
          isRetrying={isLoading}
          onFocusOwnershipChange={(focusOwner) => {
            loadRecoveryFocusOwnerRef.current = focusOwner
              ? { element: focusOwner, sessionId: displaySession.id }
              : null;
          }}
          onRetry={onRetryLoad}
        />
      ) : displayedSessionDetail && textOnlyTranscriptEntries.length > 0 ? (
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

      {hasBlockingLoadError ? null : (
        <div className={clsx(styles.bottom, styles.bottomAttached)}>
        {!sessionCommandsEnabled ? (
          <p className={styles.nextMessageSubtle}>
            {sessionCommandsUnavailableReason}
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

              if (isSharedLiveThread) {
                const confirmed = await requestCurrentSessionConfirmation({
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
          <p className={clsx(styles.nextMessageSubtle, styles.nextMessageConnection)}>
            {attachedSessionHint}
          </p>
        ) : !isReviewOnlyRuntime && !isHydratingSelection && isSharedLiveThread && displaySession.attachModeReason ? (
          <p className={styles.nextMessageSubtle}>
            {displaySession.attachModeReason}
          </p>
        ) : null}
        </div>
      )}
    </div>
  );
});

AgentTranscriptPanel.displayName = "AgentTranscriptPanel";
