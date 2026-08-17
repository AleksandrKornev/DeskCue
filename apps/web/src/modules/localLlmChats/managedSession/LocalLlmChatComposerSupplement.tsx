import { LocalLlmActionRequestCard } from "@modules/localLlmChats/agentMode/LocalLlmActionRequestCard";
import styles from "@modules/localLlmChats/shared/styles.module.scss";

import type { LocalLlmChatComposerSupplementProps } from "./types";

export function LocalLlmChatComposerSupplement({
  detail,
  onDiscardLmStudioPrompt,
  onResolveAction,
  onStartLmStudioAndSend,
  startingLmStudio
}: LocalLlmChatComposerSupplementProps) {
  const pendingLmStudioPrompt = detail.pendingLmStudioPrompt;

  return (
    <>
      {pendingLmStudioPrompt ? (
        <section className={styles.lmStudioStartAction} aria-label="Saved LM Studio message">
          <div className={styles.lmStudioStartCopy}>
            <div className={styles.lmStudioStartTitle}>
              <span aria-hidden="true" className={styles.lmStudioStartIndicator} />
              <strong>Message ready to send</strong>
            </div>
            <p>
              {pendingLmStudioPrompt.reason === "server_off"
                ? "Start Local Server; DeskCue will load this chat's model and send the saved message."
                : "DeskCue will load this chat's model and send the saved message."}
            </p>
          </div>
          <div className={styles.lmStudioStartActions}>
            <button
              className={styles.primaryButton}
              disabled={startingLmStudio}
              onClick={onStartLmStudioAndSend}
              type="button"
            >
              {startingLmStudio
                ? "Preparing LM Studio..."
                : pendingLmStudioPrompt.reason === "server_off" ? "Start Local Server and send" : "Load model and send"}
            </button>
            <button
              className={styles.lmStudioDiscardButton}
              disabled={startingLmStudio}
              onClick={onDiscardLmStudioPrompt}
              type="button"
            >
              Discard saved message
            </button>
          </div>
        </section>
      ) : null}
      {detail.actionRequests.filter((request) => request.status === "pending").map((request) => (
        <LocalLlmActionRequestCard
          key={request.id}
          request={{
            actionLabel: request.action === "apply_unified_diff" ? "Apply changes" : "Run command",
            description: request.summary,
            id: request.id,
            scope: detail.workspace?.name ?? null,
            status: request.status,
            title: request.action === "apply_unified_diff" ? "Apply proposed changes" : "Run workspace command"
          }}
          onApprove={(id) => onResolveAction(id, "approve")}
          onReject={(id) => onResolveAction(id, "reject")}
        />
      ))}
    </>
  );
}
