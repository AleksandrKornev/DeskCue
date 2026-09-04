import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./styles.module.scss";

export type SessionOpeningSkeletonProps = {
  errorMessage?: string | null;
  exitLabel?: string;
  loadingLabel?: string;
  onExit?: () => void;
  onRetry?: (context: SessionOpeningRetryContext) => Promise<unknown>;
};

export type SessionOpeningRetryContext = {
  hasFocusOwnership: () => boolean;
};

function useSessionOpeningRetry(
  errorMessage: string | null | undefined,
  onRetry: ((context: SessionOpeningRetryContext) => Promise<unknown>) | undefined
) {
  const [isRetrying, setIsRetrying] = useState(false);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const retryFocusOwnerRef = useRef<HTMLButtonElement | null>(null);
  const retryGenerationRef = useRef(0);
  const retryPendingRef = useRef(false);

  useEffect(() => () => {
    retryGenerationRef.current += 1;
    retryPendingRef.current = false;
  }, []);

  useEffect(() => {
    const focusOwner = retryFocusOwnerRef.current;

    if (!errorMessage || isRetrying || !focusOwner) return;

    const activeElement = document.activeElement;
    const focusReturnedToDocument =
      activeElement === document.body || activeElement === document.documentElement;
    const focusMovedElsewhere = focusOwner.isConnected
      ? activeElement !== focusOwner
      : !focusReturnedToDocument;

    if (focusMovedElsewhere) {
      retryFocusOwnerRef.current = null;
      return;
    }

    retryButtonRef.current?.focus();
  }, [errorMessage, isRetrying]);

  const retry = useCallback(async (focusOwner: HTMLButtonElement | null) => {
    if (!onRetry || retryPendingRef.current) return;

    const generation = retryGenerationRef.current;

    retryPendingRef.current = true;
    retryFocusOwnerRef.current = focusOwner;
    setIsRetrying(true);

    try {
      await onRetry({
        hasFocusOwnership: () => Boolean(focusOwner) && retryFocusOwnerRef.current === focusOwner
      });
    } catch {
      // The caller owns public error copy; keep the current recovery surface stable.
    } finally {
      if (retryGenerationRef.current === generation) {
        retryPendingRef.current = false;
        setIsRetrying(false);
      }
    }
  }, [onRetry]);

  return {
    isRetrying,
    retry,
    retryButtonRef,
    retryFocusOwnerRef
  };
}

export function SessionOpeningSkeleton({
  errorMessage,
  exitLabel = "Back to chats",
  loadingLabel = "Loading source-agent chat",
  onExit,
  onRetry
}: SessionOpeningSkeletonProps) {
  const {
    isRetrying,
    retry,
    retryButtonRef,
    retryFocusOwnerRef
  } = useSessionOpeningRetry(errorMessage, onRetry);

  if (errorMessage) {
    return (
      <div aria-busy={isRetrying} className={styles.sessionLoadError} role="alert">
        <h1>Session unavailable</h1>
        <p>Unable to load the session</p>
        <span>{errorMessage}</span>
        {onRetry || onExit ? (
          <div className={styles.sessionLoadActions}>
            {onRetry ? (
              <button
                aria-disabled={isRetrying}
                className={styles.sessionLoadRetry}
                data-session-retry-control
                ref={retryButtonRef}
                type="button"
                onBlur={() => {
                  retryFocusOwnerRef.current = null;
                }}
                onClick={(event) => {
                  if (isRetrying) return;

                  const focusOwner = document.activeElement === event.currentTarget
                    ? event.currentTarget
                    : null;

                  void retry(focusOwner);
                }}
              >
                {isRetrying ? "Retrying…" : "Retry"}
              </button>
            ) : null}
            {onExit ? (
              <button className={styles.sessionLoadExit} onClick={onExit} type="button">
                {exitLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      aria-busy="true"
      aria-label={loadingLabel}
      className={styles.sessionOpeningSkeleton}
      role="status"
    >
      <div className={styles.toolbarShell} data-loading-region="toolbar">
        <div className={styles.sessionOpeningHeader}>
          <div className={styles.sessionOpeningCopy}>
            <div className={styles.sessionOpeningTitleRow}>
              <span className={clsx(styles.skeletonBlock, styles.sessionOpeningTitle)} />
              <span className={clsx(styles.skeletonPill, styles.sessionOpeningStatus)} />
            </div>
            <div className={styles.sessionOpeningMetaRow}>
              <span className={clsx(styles.skeletonPill, styles.sessionOpeningPill)} />
              <span className={clsx(styles.skeletonPill, styles.sessionOpeningPillWide)} />
              <span className={clsx(styles.skeletonPill, styles.sessionOpeningPill)} />
            </div>
            <span className={clsx(styles.skeletonBlock, styles.sessionOpeningMeta)} />
          </div>
          <div className={styles.sessionOpeningActions}>
            <span className={clsx(styles.skeletonPill, styles.sessionOpeningAction)} />
            <span className={clsx(styles.skeletonPill, styles.sessionOpeningIcon)} />
          </div>
        </div>
        <div className={styles.sessionOpeningTabs}>
          <span className={styles.sessionOpeningTabActive} />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className={styles.sessionOpeningWorkspace}>
        <div className={styles.sessionOpeningThread} data-loading-region="transcript">
          <span className={styles.sessionOpeningDay} />
          <div className={styles.sessionOpeningCluster}>
            <div className={clsx(styles.sessionOpeningMessage, styles.sessionOpeningMessageAssistant)}>
              <span className={styles.sessionOpeningMessageMeta} />
              <span className={styles.sessionOpeningLineWide} />
              <span className={styles.sessionOpeningLineMid} />
            </div>
            <div className={clsx(styles.sessionOpeningMessage, styles.sessionOpeningMessageUser)}>
              <span className={styles.sessionOpeningMessageMeta} />
              <span className={styles.sessionOpeningLineMid} />
            </div>
          </div>
          <div className={clsx(styles.sessionOpeningCluster, styles.sessionOpeningClusterBottom)}>
            <div className={clsx(styles.sessionOpeningMessage, styles.sessionOpeningMessageAssistant)}>
              <span className={styles.sessionOpeningMessageMeta} />
              <span className={styles.sessionOpeningLineWide} />
              <span className={styles.sessionOpeningLineShort} />
            </div>
            <div className={clsx(styles.sessionOpeningMessage, styles.sessionOpeningMessageUser)}>
              <span className={styles.sessionOpeningMessageMeta} />
              <span className={styles.sessionOpeningLineWide} />
            </div>
          </div>
        </div>
      </div>

      <div className={styles.sessionOpeningComposerShell} data-loading-region="composer">
        <div className={styles.sessionOpeningComposer}>
          <span className={clsx(styles.skeletonBlock, styles.sessionOpeningComposerField)} />
          <span className={clsx(styles.skeletonPill, styles.sessionOpeningSendButton)} />
        </div>
      </div>
    </div>
  );
}
