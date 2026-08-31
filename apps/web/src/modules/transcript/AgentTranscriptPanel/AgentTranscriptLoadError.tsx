import { useRef } from "react";

import styles from "./styles.module.scss";

type AgentTranscriptLoadErrorProps = {
  errorMessage: string;
  isRetrying: boolean;
  onFocusOwnershipChange: (focusOwner: HTMLButtonElement | null) => void;
  onRetry: () => void;
};

export function AgentTranscriptLoadError({
  errorMessage,
  isRetrying,
  onFocusOwnershipChange,
  onRetry
}: AgentTranscriptLoadErrorProps) {
  const retryButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      aria-busy={isRetrying}
      className={styles.loadError}
      role="alert"
    >
      <span className={styles.loadErrorLabel}>Chat unavailable</span>
      <strong>Unable to load chat</strong>
      <p>{errorMessage}</p>
      <button
        aria-disabled={isRetrying}
        className={styles.retryButton}
        onBlur={() => onFocusOwnershipChange(null)}
        onClick={() => {
          if (isRetrying) return;

          onFocusOwnershipChange(
            document.activeElement === retryButtonRef.current ? retryButtonRef.current : null
          );

          onRetry();
        }}
        ref={retryButtonRef}
        type="button"
      >
        {isRetrying ? <span className={styles.spinner} aria-hidden="true" /> : null}
        <span>{isRetrying ? "Retrying…" : "Retry"}</span>
      </button>
    </div>
  );
}
