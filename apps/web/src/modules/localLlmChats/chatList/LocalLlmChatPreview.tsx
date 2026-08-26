import { Link } from "react-router";

import type { LocalLlmChatSummary, RuntimeSummary } from "@deskcue/protocol";
import { formatDate } from "@lib/format";
import { useLocalLlmChatController } from "@modules/localLlmChats/managedSession/controllers/useLocalLlmChatController";
import styles from "@modules/localLlmChats/shared/styles.module.scss";

export type LocalLlmChatPreviewProps = {
  chat: LocalLlmChatSummary;
  runtime: RuntimeSummary | null;
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

export function LocalLlmChatPreview({ chat, runtime }: LocalLlmChatPreviewProps) {
  const { detail, error } = useLocalLlmChatController(chat.id);
  const runtimeLabel = runtime?.label ?? (chat.runtimeId === "lm-studio" ? "LM Studio" : "Ollama");
  const previewStatus = readPreviewStatus(chat, runtime);

  const previewEntries = detail?.messages.slice(-2) ?? [];

  return (
    <section className={styles.preview} aria-label={`${runtimeLabel} chat preview`}>
      <header className={styles.previewHeader}>
        <div>
          <strong>{chat.title}</strong>
          <span>{chat.workspace?.name ?? "No workspace linked"}</span>
        </div>
        <div className={styles.previewMeta}>
          <span className={styles.runtimePill}>{runtimeLabel}</span>
          <span className={styles.statusPill} data-running={chat.generationState === "running" || undefined}>
            {previewStatus}
          </span>
          <span>{formatDate(chat.updatedAt)}</span>
        </div>
      </header>

      <div className={styles.previewTranscript} aria-live="polite">
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : !detail ? (
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
