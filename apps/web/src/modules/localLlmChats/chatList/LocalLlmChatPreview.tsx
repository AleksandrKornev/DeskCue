import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import type {
  LocalLlmChatDetail,
  LocalLlmChatSummary,
  RuntimeSummary
} from "@deskcue/protocol";
import { formatDate } from "@lib/format";
import { useLocalLlmChatController } from "@modules/localLlmChats/managedSession/controllers/useLocalLlmChatController";
import styles from "@modules/localLlmChats/shared/styles.module.scss";

export type LocalLlmChatPreviewProps = {
  chat: LocalLlmChatSummary;
  runtime: RuntimeSummary | null;
};

type LocalLlmPreviewRetryOptions = {
  chatId: string;
  error: string | null;
  refresh: (tail?: "initial" | "live") => Promise<LocalLlmChatDetail | null>;
  setError: (error: string | null) => void;
};

function readPreviewStatus(
  chat: LocalLlmChatSummary,
  runtime: RuntimeSummary | null
) {
  if (chat.generationState === "running") return "Generating";
  if (chat.generationState === "waiting_approval") return "Needs approval";
  if (chat.generationState === "failed") return "Failed";
  if (chat.generationState === "interrupted") return "Interrupted";
  if (!runtime) return "Runtime status unavailable";
  if (!runtime.installed) return "Runtime unavailable";
  if (!runtime.running) return "Runtime offline";

  return "Idle";
}

function useLocalLlmPreviewRetry({
  chatId,
  error,
  refresh,
  setError
}: LocalLlmPreviewRetryOptions) {
  const [isRetrying, setIsRetrying] = useState(false);
  const previewTranscriptRef = useRef<HTMLDivElement>(null);
  const retryFocusOwnerRef = useRef<HTMLButtonElement | null>(null);
  const retryGenerationRef = useRef(0);
  const retryPendingRef = useRef(false);
  const currentChatIdRef = useRef(chatId);

  currentChatIdRef.current = chatId;

  useEffect(() => {
    retryGenerationRef.current += 1;
    retryPendingRef.current = false;
    retryFocusOwnerRef.current = null;
    setIsRetrying(false);

    return () => {
      retryGenerationRef.current += 1;
      retryPendingRef.current = false;
      retryFocusOwnerRef.current = null;
    };
  }, [chatId]);

  useEffect(() => {
    const focusOwner = retryFocusOwnerRef.current;

    if (!focusOwner || error || isRetrying) return;

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

    previewTranscriptRef.current?.focus();
    retryFocusOwnerRef.current = null;
  }, [error, isRetrying]);

  const retry = useCallback(async (focusOwner: HTMLButtonElement | null) => {
    if (retryPendingRef.current) return;

    const generation = retryGenerationRef.current;
    const retryChatId = chatId;

    retryPendingRef.current = true;

    retryFocusOwnerRef.current = focusOwner;
    setIsRetrying(true);

    try {
      const nextDetail = await refresh("initial");

      const isCurrentRetry =
        currentChatIdRef.current === retryChatId &&
        retryGenerationRef.current === generation;

      if (isCurrentRetry && nextDetail) setError(null);
    } catch {
      // Preserve the existing safe recovery surface until another retry succeeds.
    } finally {
      const isCurrentRetry =
        currentChatIdRef.current === retryChatId &&
        retryGenerationRef.current === generation;

      if (isCurrentRetry) {
        retryPendingRef.current = false;
        setIsRetrying(false);
      }
    }
  }, [chatId, refresh, setError]);

  return {
    isRetrying,
    previewTranscriptRef,
    retry,
    retryFocusOwnerRef
  };
}

function LocalLlmChatPreviewContent({ chat, runtime }: LocalLlmChatPreviewProps) {
  const { detail, error, refresh, setError } = useLocalLlmChatController(chat.id);
  const currentDetail = detail?.id === chat.id ? detail : null;
  const runtimeLabel = runtime?.label ?? (chat.runtimeId === "lm-studio" ? "LM Studio" : "Ollama");
  const previewStatus = error
    ? "Preview unavailable"
    : currentDetail
      ? readPreviewStatus(chat, runtime)
      : "Loading preview";

  const {
    isRetrying,
    previewTranscriptRef,
    retry,
    retryFocusOwnerRef
  } = useLocalLlmPreviewRetry({
    chatId: chat.id,
    error,
    refresh,
    setError
  });

  const previewEntries = currentDetail?.messages.slice(-2) ?? [];

  return (
    <section className={styles.preview} aria-label={`${runtimeLabel} chat preview`}>
      <header className={styles.previewHeader}>
        <div>
          <strong>{chat.title}</strong>
          <span>{chat.workspace?.name ?? "No workspace linked"}</span>
        </div>
        <div className={styles.previewMeta}>
          <span className={styles.runtimePill}>{runtimeLabel}</span>
          <span
            className={styles.statusPill}
            data-error={Boolean(error) || undefined}
            data-running={
              Boolean(currentDetail && !error && chat.generationState === "running") || undefined
            }
          >
            {previewStatus}
          </span>
          <span>{formatDate(chat.updatedAt)}</span>
        </div>
      </header>

      <div
        aria-label={`${runtimeLabel} chat preview content`}
        className={styles.previewTranscript}
        ref={previewTranscriptRef}
        tabIndex={-1}
      >
        {currentDetail && !error ? (
          <span className={styles.previewStatusAnnouncement} role="status">Preview loaded</span>
        ) : null}
        {error ? (
          <div aria-busy={isRetrying} className={styles.previewLoadError} role="alert">
            <span>Preview unavailable</span>
            <strong>Unable to load local chat preview</strong>
            <p>The local chat may have changed or its runtime may be unavailable.</p>
            <button
              aria-disabled={isRetrying}
              className={styles.previewRetryButton}
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
              type="button"
            >
              <span>{isRetrying ? "Retrying…" : "Retry preview"}</span>
            </button>
          </div>
        ) : !currentDetail ? (
          <p className={styles.previewEmpty}>Loading chat preview</p>
        ) : previewEntries.length === 0 ? (
          <p className={styles.previewEmpty}>No messages in this chat yet</p>
        ) : (
          previewEntries.map((entry) => (
            <article className={`${styles.message} ${styles[entry.role]}`} key={entry.id}>
              <strong>{entry.role === "user" ? "You" : runtimeLabel}</strong>
              <p>{entry.text}</p>
            </article>
          ))
        )}
      </div>

      <div className={styles.previewAction}>
        <Link className={styles.primaryButton} to={`/local-llm/chats/${chat.id}`}>
          Open live chat
        </Link>
        <p>{chat.model} · DeskCue-owned local model chat</p>
      </div>
    </section>
  );
}

export function LocalLlmChatPreview(props: LocalLlmChatPreviewProps) {
  return <LocalLlmChatPreviewContent key={props.chat.id} {...props} />;
}
